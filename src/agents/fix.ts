import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Diagnostic } from "../types.js";
import { highlighter, logger, sanitize } from "../output/logger.js";
import { detectAgents, getPreferredAgent } from "./detect.js";

const FIX_PROMPT = `# Automated Fix Session

You are an expert software engineer on Svelte. svelte-doctor has analyzed this codebase and produced the diagnostics below. Your job is to fix every issue precisely and safely.

## Rules of engagement

- Fix issues in priority order: Security → Correctness → Performance → Architecture → everything else
- Read each file before editing it. Do not guess at context.
- Apply the minimal change that resolves the issue; do not refactor unrelated code
- Preserve existing code style, naming conventions, and formatting
- If a fix for one diagnostic makes another diagnostic obsolete, skip the duplicate
- After all fixes are applied, run: svelte-doctor check
  - If the score improved, report the before/after score and summarize what was changed
  - If new issues appeared, fix those too before finishing

## Severity reference

- ERROR must be fixed. These are security risks or Svelte breaking changes.
- WARNING should be fixed. These hurt performance, bundle size, or maintainability.

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

// writes prompt to a temp file instead of passing as CLI arg
// this avoids OS arg length limits and option-confusion attacks
const writePromptFile = (prompt: string): string => {
  const tmpDir = os.tmpdir();
  const promptPath = path.join(tmpDir, `svelte-doctor-prompt-${process.pid}.txt`);
  fs.writeFileSync(promptPath, prompt, "utf-8");
  return promptPath;
};

// builds agent-specific arguments for spawning
const buildAgentArgs = (agent: string, promptPath: string): string[] => {
  if (agent === "amp") return ["--prompt-file", promptPath];
  if (agent === "claude") return ["--print", `$(cat ${promptPath})`];
  // Codex and unknown agents just pass the file path.
  return [promptPath];
};

// spawns the agent process with the prompt piped through stdin
// This is the safest approach without shell or arg length limits.
const spawnAgent = (
  command: string,
  cwd: string,
  prompt: string,
): Promise<number> => {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      cwd,
      stdio: ["pipe", "inherit", "inherit"],
    });

    child.stdin.write(prompt);
    child.stdin.end();

    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
};

export const runFix = async (directory: string, diagnostics: Diagnostic[], agentOverride?: string) => {
  if (diagnostics.length === 0) {
    logger.success("  ✓ No issues to fix!");
    return;
  }

  const agents = detectAgents();
  const available = agents.filter((a) => a.available);

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

  if (agentOverride) {
    const forced = agents.find((a) => a.command === agentOverride);
    if (!forced) {
      logger.error(`  Unknown agent: ${agentOverride}. Available: amp, claude, codex`);
      return;
    }
    if (!forced.available) {
      logger.error(`  Agent "${agentOverride}" is not installed.`);
      return;
    }
    logger.log(`  Using ${highlighter.info(forced.name)} (forced) to fix ${highlighter.warn(String(diagnostics.length))} issues...`);
    const prompt = FIX_PROMPT + formatDiagnosticsForAgent(diagnostics);
    const resolvedDir = path.resolve(directory);
    const code = await spawnAgent(forced.command, resolvedDir, prompt);

    if (code === 0) {
      logger.break();
      logger.success("  ✓ Agent finished. Run `svelte-doctor check` to verify improvements.");
      return;
    }

    const promptPath = writePromptFile(prompt);
    logger.break();
    logger.dim(`  Agent exited with code ${code}. Prompt saved to:`);
    logger.info(`  ${promptPath}`);
    logger.break();
    logger.dim("  Paste the file contents into your preferred AI agent manually.");
    return;
  }

  if (available.length === 0) {
    logger.error("  No coding agents found on your system.");
    logger.break();
    logger.log("  Install one of the following:");
    logger.dim("    • Amp:         https://ampcode.com/");
    logger.dim("    • Claude Code: https://docs.anthropic.com/en/docs/claude-code");
    logger.dim("    • Codex:       https://github.com/openai/codex");
    logger.break();
    return;
  }

  const preferred = getPreferredAgent()!;
  logger.log(`  Using ${highlighter.info(preferred.name)} to fix ${highlighter.warn(String(diagnostics.length))} issues...`);
  logger.break();

  const prompt = FIX_PROMPT + formatDiagnosticsForAgent(diagnostics);
  const resolvedDir = path.resolve(directory);

  const code = await spawnAgent(preferred.command, resolvedDir, prompt);

  if (code === 0) {
    logger.break();
    logger.success("  ✓ Agent finished. Run `svelte-doctor check` to verify improvements.");
    return;
  }

  // Agent failed or does not support stdin so write prompt to file as fallback.
  const promptPath = writePromptFile(prompt);
  logger.break();
  logger.dim(`  Agent exited with code ${code}. Prompt saved to:`);
  logger.info(`  ${promptPath}`);
  logger.break();
  logger.dim("  Paste the file contents into your preferred AI agent manually.");
};
