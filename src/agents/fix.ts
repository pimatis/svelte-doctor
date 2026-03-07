import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentInfo, Diagnostic } from "../types.js";
import { highlighter, logger } from "../output/logger.js";
import { detectAgents, getPreferredAgent } from "./detect.js";
import { scan } from "../core/scanner.js";

const FIX_PROMPT = `# Automated Fix Session

You are an expert software engineer on Svelte. svelte-doctor has analyzed this codebase and produced the diagnostics below. Your job is to fix every issue precisely and safely.

## Critical: Do NOT introduce new issues

Your fixes must not create new svelte-doctor diagnostics. Common mistakes that increase the error count:

- **no-secrets → no-public-env-secrets**: When moving secrets to env vars, ALWAYS use \`$env/static/private\` or \`$env/dynamic/private\`. NEVER use \`$env/static/public\` or \`$env/dynamic/public\` for secrets, API keys, or tokens.

- **no-legacy-reactive → no-derived-side-effect**: \`$:\` with side effects (console.log, fetch, DOM access, localStorage) MUST become \`$effect()\`. Only use \`$derived()\` for PURE computations with no side effects.

- **no-legacy-lifecycle**: Replace \`onMount\`/\`onDestroy\` with \`$effect()\`. If the callback returns a cleanup function, use \`$effect(() => { ...; return () => cleanup; })\`.

- **$derived must be pure**: Never put console, fetch, document, window, localStorage, or any mutation inside \`$derived()\`. Use \`$effect()\` for side effects.

## Rules of engagement

- Fix issues in priority order: Security → Correctness → Performance → Architecture → everything else
- Read each file before editing it. Do not guess at context
- Apply the minimal change that resolves the issue; do not refactor unrelated code
- Preserve existing code style, naming conventions, and formatting
- If a fix for one diagnostic makes another obsolete, skip the duplicate
- After ALL fixes: run \`svelte-doctor check\` and verify the error count did NOT increase
- If new errors appeared, fix those too before finishing. Do not stop until errors are resolved or unchanged

## Severity reference

- ERROR must be fixed. These are security risks or Svelte breaking changes
- WARNING should be fixed. These hurt performance, bundle size, or maintainability

## Diagnostics

`;

const formatDiagnosticsForAgent = (diagnostics: Diagnostic[]): string => {
  // group by category so the agent processes related issues together
  const byCategory = new Map<string, Diagnostic[]>();

  for (const diag of diagnostics) {
    const group = byCategory.get(diag.category) ?? [];
    group.push(diag);
    byCategory.set(diag.category, group);
  }

  // severity order matches fix priority defined in the prompt above
  const categoryOrder = [
    "Security",
    "Correctness",
    "Performance",
    "State & Reactivity",
    "SvelteKit",
    "Architecture",
    "Accessibility",
    "Bundle Size",
    "Dead Code",
  ];

  const orderedCategories = [
    ...categoryOrder.filter((c) => byCategory.has(c)),
    ...[...byCategory.keys()].filter((c) => !categoryOrder.includes(c)),
  ];

  const lines: string[] = [];

  for (const category of orderedCategories) {
    const group = byCategory.get(category)!;
    lines.push(`### ${category} (${group.length} issue${group.length === 1 ? "" : "s"})`);
    lines.push("");

    for (const diag of group) {
      const location = diag.line > 0
        ? `${diag.filePath}:${diag.line}:${diag.column}`
        : diag.filePath;

      lines.push(`[${diag.severity.toUpperCase()}] ${diag.rule}`);
      lines.push(`  Location : ${location}`);
      lines.push(`  Problem  : ${diag.message}`);
      if (diag.help) lines.push(`  Fix      : ${diag.help}`);
      lines.push("");
    }
  }

  return lines.join("\n");
};

// writes prompt to a temp file and returns its path
// avoids OS arg length limits when passing diagnostics to agents
const writePromptFile = (prompt: string): string => {
  const tmpDir = os.tmpdir();
  const promptPath = path.join(tmpDir, `svelte-doctor-prompt-${process.pid}.txt`);
  fs.writeFileSync(promptPath, prompt, "utf-8");
  return promptPath;
};

const cleanupPromptFile = (promptPath: string): void => {
  try {
    fs.unlinkSync(promptPath);
  } catch {}
};

// Most agents read prompt from stdin; Cursor only accepts prompt as positional [prompt...] args
const spawnAgent = (agent: AgentInfo, cwd: string, prompt: string): Promise<number> => {
  const baseArgs = agent.getSpawnArgs?.(cwd) ?? [];
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
        if (buffer.trim()) {
          const formatted = formatOutput(buffer);
          if (formatted) process.stdout.write(formatted);
        }
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

export type FixResult = {
  agentExitedSuccess: boolean;
  beforeErrors: number;
  beforeWarnings: number;
  afterErrors?: number;
  afterWarnings?: number;
  errorsIncreased?: boolean;
};

export const runFix = async (
  directory: string,
  diagnostics: Diagnostic[],
  agentOverride?: string,
): Promise<FixResult> => {
  const beforeErrors = diagnostics.filter((d) => d.severity === "error").length;
  const beforeWarnings = diagnostics.filter((d) => d.severity === "warning").length;

  if (diagnostics.length === 0) {
    logger.success("  ✓ No issues to fix!");
    return { agentExitedSuccess: true, beforeErrors: 0, beforeWarnings: 0 };
  }

  const agents = detectAgents();

  logger.break();
  logger.log("  Detected coding agents:");
  logger.break();

  for (const agent of agents) {
    const status = agent.available
      ? highlighter.success("✓ installed")
      : highlighter.dim("✗ not found");
    logger.log(`    ${agent.name}: ${status}`);
  }

  logger.break();

  const prompt = FIX_PROMPT + formatDiagnosticsForAgent(diagnostics);

  if (agentOverride) {
    const forced = agents.find((a) => (a.id ?? a.command) === agentOverride);

    if (!forced) {
      logger.error(`  Unknown agent: ${agentOverride}. Available: cursor, amp, claude, codex`);
      return { agentExitedSuccess: false, beforeErrors, beforeWarnings };
    }

    if (!forced.available) {
      logger.error(`  Agent "${agentOverride}" is not installed.`);
      return { agentExitedSuccess: false, beforeErrors, beforeWarnings };
    }

    logger.log(`  Using ${highlighter.info(forced.name)} (forced) to fix ${highlighter.warn(String(diagnostics.length))} issues...`);
    if (forced.formatStreamingOutput) {
      logger.dim("  Large fix sets may take several minutes. Streaming output below...");
    }
    logger.break();

    const promptPath = writePromptFile(prompt);
    const code = await spawnAgent(forced, directory, prompt);

    if (code === 0) {
      cleanupPromptFile(promptPath);
      return verifyFixResult(directory, beforeErrors, beforeWarnings);
    }

    printPromptFallback(promptPath, code);
    return { agentExitedSuccess: false, beforeErrors, beforeWarnings };
  }

  const available = agents.filter((a) => a.available);

  if (available.length === 0) {
    logger.error("  No coding agents found on your system.");
    logger.break();
    logger.log("  Install one of the following:");
    logger.dim("    • Cursor:      https://cursor.com/cli (installs as 'agent')");
    logger.dim("    • Amp:         https://ampcode.com/");
    logger.dim("    • Claude Code: https://docs.anthropic.com/en/docs/claude-code");
    logger.dim("    • Codex:       https://github.com/openai/codex");
    logger.break();

    const promptPath = writePromptFile(prompt);
    logger.dim("  Prompt saved for manual use:");
    logger.info(`  ${promptPath}`);
    logger.break();

    return { agentExitedSuccess: false, beforeErrors, beforeWarnings };
  }

  const preferred = getPreferredAgent();

  // getPreferredAgent returns null only when available is empty, guarded above
  if (!preferred) {
    logger.error("  Could not determine preferred agent.");
    return { agentExitedSuccess: false, beforeErrors, beforeWarnings };
  }

  logger.log(`  Using ${highlighter.info(preferred.name)} to fix ${highlighter.warn(String(diagnostics.length))} issues...`);
  if (preferred.formatStreamingOutput) {
    logger.dim("  Large fix sets may take several minutes. Streaming output below...");
  }
  logger.break();

  const promptPath = writePromptFile(prompt);
  const code = await spawnAgent(preferred, directory, prompt);

  if (code === 0) {
    cleanupPromptFile(promptPath);
    return verifyFixResult(directory, beforeErrors, beforeWarnings);
  }

  printPromptFallback(promptPath, code);
  return { agentExitedSuccess: false, beforeErrors, beforeWarnings };
};

const verifyFixResult = async (
  directory: string,
  beforeErrors: number,
  beforeWarnings: number,
): Promise<FixResult> => {
  logger.break();
  logger.dim("  Verifying fixes...");

  try {
    const result = await scan(directory, { quiet: true });
    const afterErrors = result.diagnostics.filter((d) => d.severity === "error").length;
    const afterWarnings = result.diagnostics.filter((d) => d.severity === "warning").length;
    const errorsIncreased = afterErrors > beforeErrors;

    logger.break();

    if (errorsIncreased) {
      logger.error(`  ⚠ Verification failed: errors increased from ${beforeErrors} to ${afterErrors}`);
      logger.dim("    Some fixes may have introduced new issues. Run svelte-doctor check to see details.");
      logger.dim("    Consider running svelte-doctor fix again; the improved prompt should avoid common cascade errors.");
      logger.break();

      return {
        agentExitedSuccess: true,
        beforeErrors,
        beforeWarnings,
        afterErrors,
        afterWarnings,
        errorsIncreased: true,
      };
    }

    if (afterErrors < beforeErrors || afterWarnings < beforeWarnings) {
      const msg = afterErrors < beforeErrors
        ? `  ✓ Errors reduced: ${beforeErrors} → ${afterErrors}`
        : `  ✓ Errors unchanged: ${beforeErrors}`;

      logger.success(msg);

      if (afterWarnings < beforeWarnings) {
        logger.success(`  ✓ Warnings reduced: ${beforeWarnings} → ${afterWarnings}`);
      }
    } else {
      logger.success("  ✓ Agent finished. No new issues introduced.");
    }

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
    };
  } catch {
    logger.break();
    logger.success("  ✓ Agent finished.");
    logger.dim("  Run svelte-doctor check to verify improvements.");
    logger.break();

    return {
      agentExitedSuccess: true,
      beforeErrors,
      beforeWarnings,
    };
  }
};