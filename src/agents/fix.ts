import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_FIX_MAX_FILES } from "../constants.js";
import type { AgentInfo, Diagnostic, VerificationLevel } from "../types.js";
import { highlighter, logger } from "../output/logger.js";
import { formatDiagnosticsForPrompt } from "../core/diagnostics-prompt.js";
import { detectAgents, getPreferredAgent } from "./detect.js";
import { scan } from "../core/scanner.js";

const createPromptBundle = (prompt: string): { dir: string; path: string } => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-doctor-"));
  const promptPath = path.join(dir, "prompt.txt");
  fs.writeFileSync(promptPath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir, path: promptPath };
};

const cleanupPromptBundle = (bundle: { dir: string; path: string }): void => {
  try {
    fs.rmSync(bundle.dir, { recursive: true, force: true });
  } catch {}
};

const spawnAgent = (
  agent: AgentInfo,
  cwd: string,
  prompt: string,
  mode: "safe" | "unsafe",
): Promise<number> => {
  const baseArgs = agent.getSpawnArgs?.(cwd, mode) ?? [];
  const args = agent.usePromptAsArg ? [...baseArgs, prompt] : baseArgs;
  const formatOutput = agent.formatStreamingOutput;
  const stdoutMode = formatOutput ? "pipe" : "inherit";
  const stdinMode = agent.usePromptAsArg ? "ignore" : "pipe";
  const stdio: [typeof stdinMode, typeof stdoutMode, "inherit"] = [stdinMode, stdoutMode, "inherit"];

  return new Promise((resolve) => {
    const child = spawn(agent.command, args, { cwd, stdio });

    if (!agent.usePromptAsArg && child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    if (formatOutput && child.stdout) {
      let buffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const formatted = formatOutput(line);
          if (formatted) process.stdout.write(formatted);
        }
      });
      child.stdout.on("end", () => {
        if (!buffer.trim()) return;
        const formatted = formatOutput(buffer);
        if (formatted) process.stdout.write(formatted);
      });
    }

    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
};

const printPromptFallback = (promptPath: string, exitCode: number): void => {
  logger.break();
  logger.dim(`  Agent exited with code ${exitCode}. Prompt saved to:`);
  logger.info(`  ${promptPath}`);
  logger.break();
  logger.dim("  Paste the file contents into your preferred AI agent manually.");
};

const detectPackageManager = (directory: string): { command: string; args: (script: string) => string[] } => {
  if (fs.existsSync(path.join(directory, "bun.lockb"))) {
    return { command: "bun", args: (script) => ["run", script] };
  }
  if (fs.existsSync(path.join(directory, "pnpm-lock.yaml"))) {
    return { command: "pnpm", args: (script) => ["run", script] };
  }
  if (fs.existsSync(path.join(directory, "yarn.lock"))) {
    return { command: "yarn", args: (script) => [script] };
  }
  return { command: "npm", args: (script) => ["run", script] };
};

const runCommand = (command: string, args: string[], cwd: string): Promise<number> =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });

const verifyScripts = async (directory: string, level: VerificationLevel): Promise<boolean> => {
  const packageManager = detectPackageManager(directory);

  const runScript = async (script: string): Promise<boolean> => {
    logger.dim(`  Running ${packageManager.command} ${packageManager.args(script).join(" ")}...`);
    const exitCode = await runCommand(packageManager.command, packageManager.args(script), directory);
    return exitCode === 0;
  };

  if (level === "typecheck" || level === "tests" || level === "full") {
    if (!await runScript("typecheck")) return false;
  }

  if (level === "tests" || level === "full") {
    if (!await runScript("test")) return false;
  }

  if (level === "full") {
    if (!await runScript("build")) return false;
    if (await runCommand("npm", ["pack", "--dry-run"], directory) !== 0) return false;
    if (await runCommand("node", ["dist/cli.mjs", "--version"], directory) !== 0) return false;
  }

  return true;
};

export type FixResult = {
  agentExitedSuccess: boolean;
  beforeErrors: number;
  beforeWarnings: number;
  afterErrors?: number;
  afterWarnings?: number;
  errorsIncreased?: boolean;
  verificationPassed?: boolean;
};

export type FixOptions = {
  agentOverride?: string;
  unsafeAgentExec?: boolean;
  dryRunPrompt?: boolean;
  verifyLevel?: VerificationLevel;
  maxFiles?: number;
};

const buildPrompt = (
  directory: string,
  diagnostics: Diagnostic[],
  options: Required<Pick<FixOptions, "unsafeAgentExec" | "maxFiles">>,
): string => {
  return formatDiagnosticsForPrompt(diagnostics, {
    includeHeader: true,
    directory,
    unsafeAgentExec: options.unsafeAgentExec,
    maxDiagnostics: options.maxFiles,
  });
};

export const runFix = async (
  directory: string,
  diagnostics: Diagnostic[],
  options: FixOptions = {},
): Promise<FixResult> => {
  const beforeErrors = diagnostics.filter((d) => d.severity === "error").length;
  const beforeWarnings = diagnostics.filter((d) => d.severity === "warning").length;
  const maxFiles = Math.max(1, Math.min(options.maxFiles ?? DEFAULT_FIX_MAX_FILES, diagnostics.length || DEFAULT_FIX_MAX_FILES));
  const verifyLevel = options.verifyLevel ?? "diagnostics";

  if (diagnostics.length === 0) {
    logger.success("  ✓ No issues to fix!");
    return {
      agentExitedSuccess: true,
      beforeErrors: 0,
      beforeWarnings: 0,
      verificationPassed: true,
    };
  }

  const agents = detectAgents();
  logger.break();
  logger.log("  Detected coding agents:");
  logger.break();
  for (const agent of agents) {
    const status = agent.available ? highlighter.success("✓ installed") : highlighter.dim("✗ not found");
    logger.log(`    ${agent.name}: ${status}`);
  }
  logger.break();

  const prompt = buildPrompt(directory, diagnostics, {
    unsafeAgentExec: options.unsafeAgentExec ?? false,
    maxFiles,
  });
  const promptBundle = createPromptBundle(prompt);

  if (options.dryRunPrompt) {
    logger.dim("  Dry-run prompt generated:");
    logger.info(`  ${promptBundle.path}`);
    logger.break();
    return {
      agentExitedSuccess: true,
      beforeErrors,
      beforeWarnings,
      verificationPassed: true,
    };
  }

  const pickAgent = (): AgentInfo | null => {
    if (options.agentOverride) {
      const forced = agents.find((a) => (a.id ?? a.command) === options.agentOverride);
      if (!forced) {
        logger.error(`  Unknown agent: ${options.agentOverride}. Available: cursor, amp, claude, codex`);
        return null;
      }
      if (!forced.available) {
        logger.error(`  Agent "${options.agentOverride}" is not installed.`);
        return null;
      }
      return forced;
    }

    return getPreferredAgent();
  };

  const agent = pickAgent();
  if (!agent) {
    logger.dim("  Prompt saved for manual use:");
    logger.info(`  ${promptBundle.path}`);
    logger.break();
    return { agentExitedSuccess: false, beforeErrors, beforeWarnings, verificationPassed: false };
  }

  logger.log(`  Using ${highlighter.info(agent.name)} to fix ${highlighter.warn(String(Math.min(diagnostics.length, maxFiles)))} issues...`);
  logger.dim(`  Agent mode: ${options.unsafeAgentExec ? highlighter.warn("unsafe opt-in") : highlighter.success("safe by default")}`);
  if (agent.formatStreamingOutput) {
    logger.dim("  Large fix sets may take several minutes. Streaming output below...");
  }
  logger.break();

  const code = await spawnAgent(agent, directory, prompt, options.unsafeAgentExec ? "unsafe" : "safe");

  if (code !== 0) {
    printPromptFallback(promptBundle.path, code);
    return { agentExitedSuccess: false, beforeErrors, beforeWarnings, verificationPassed: false };
  }

  const verification = await verifyFixResult(directory, beforeErrors, beforeWarnings, verifyLevel);
  if (verification.verificationPassed) {
    cleanupPromptBundle(promptBundle);
  } else {
    logger.dim("  Verification failed. Prompt directory kept for inspection:");
    logger.info(`  ${promptBundle.path}`);
    logger.break();
  }

  return verification;
};

const verifyFixResult = async (
  directory: string,
  beforeErrors: number,
  beforeWarnings: number,
  verifyLevel: VerificationLevel,
): Promise<FixResult> => {
  logger.break();
  logger.dim("  Verifying fixes...");

  try {
    const result = await scan(directory, { quiet: true });
    const afterErrors = result.diagnostics.filter((d) => d.severity === "error").length;
    const afterWarnings = result.diagnostics.filter((d) => d.severity === "warning").length;
    const errorsIncreased = afterErrors > beforeErrors;

    if (errorsIncreased) {
      logger.break();
      logger.error(`  ⚠ Verification failed: errors increased from ${beforeErrors} to ${afterErrors}`);
      logger.dim("    Some fixes may have introduced new issues. Run svelte-doctor check to see details.");
      logger.break();
      return {
        agentExitedSuccess: true,
        beforeErrors,
        beforeWarnings,
        afterErrors,
        afterWarnings,
        errorsIncreased: true,
        verificationPassed: false,
      };
    }

    if (!await verifyScripts(directory, verifyLevel)) {
      logger.break();
      logger.error(`  ⚠ Verification failed during ${verifyLevel} checks.`);
      logger.break();
      return {
        agentExitedSuccess: true,
        beforeErrors,
        beforeWarnings,
        afterErrors,
        afterWarnings,
        errorsIncreased: false,
        verificationPassed: false,
      };
    }

    logger.break();
    if (afterErrors < beforeErrors) {
      logger.success(`  ✓ Errors reduced: ${beforeErrors} → ${afterErrors}`);
    } else {
      logger.success(`  ✓ Errors unchanged: ${beforeErrors}`);
    }
    if (afterWarnings < beforeWarnings) {
      logger.success(`  ✓ Warnings reduced: ${beforeWarnings} → ${afterWarnings}`);
    }
    logger.success(`  ✓ Verification passed at ${verifyLevel} level.`);
    logger.break();
    logger.dim(`  Run ${highlighter.info("svelte-doctor check")} for full report.`);
    logger.break();

    return {
      agentExitedSuccess: true,
      beforeErrors,
      beforeWarnings,
      afterErrors,
      afterWarnings,
      errorsIncreased: false,
      verificationPassed: true,
    };
  } catch {
    logger.break();
    logger.error("  ⚠ Verification failed unexpectedly.");
    logger.break();
    return {
      agentExitedSuccess: true,
      beforeErrors,
      beforeWarnings,
      verificationPassed: false,
    };
  }
};
