import path from "node:path";
import { Command } from "commander";
import { scan } from "../core/scanner.js";
import { runFix } from "../agents/fix.js";
import { logger, highlighter } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { parseVerifyLevel, parsePositiveInt } from "./utils.js";
import type { VerificationLevel } from "../types.js";

export const fixCommand = new Command("fix")
  .description(
    "Use an AI agent (Cursor/Amp/Claude/Codex/Copilot/OpenCode/Pi/Gemini/Qwen/Aider/Goose) to auto-fix all reported issues",
  )
  .argument("[directory]", "project directory", ".")
  .option(
    "--agent <name>",
    "force a specific agent (cursor, amp, claude, codex, copilot, opencode, pi, gemini, qwen, aider, goose)",
  )
  .option("--errors-only", "fix only errors first (reduces cascade risk, run again for warnings)")
  .option("--unsafe-agent-exec", "allow agent-specific privileged execution flags (opt-in only)")
  .option(
    "--dry-run-prompt",
    "write the agent prompt to a secure temp file without spawning an agent",
  )
  .option(
    "--verify-level <level>",
    "verification depth: diagnostics, typecheck, tests, or full",
    parseVerifyLevel,
    "diagnostics",
  )
  .option("--max-files <count>", "maximum diagnostics to include in a single agent batch", "50")
  .addHelpText(
    "after",
    `

Supported agents:
  cursor    Cursor Agent CLI (agent --print)
  amp       Amp execute mode (amp -x)
  claude    Claude Code print mode (claude -p)
  codex     Codex exec mode (codex exec)
  copilot   Copilot CLI prompt mode (copilot -p)
  opencode  OpenCode run mode (opencode run)
  pi        Pi prompt mode (pi -p)
  gemini    Gemini CLI headless mode (gemini -p)
  qwen      Qwen Code headless mode (qwen -p)
  aider     Aider message mode (aider --message)
  goose     Goose run mode (goose run)
`,
  )
  .action(async (directory: string, flags: Record<string, unknown>) => {
    try {
      const resolvedDir = path.resolve(directory);
      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor fix")} v${VERSION}`);
      logger.break();
      const result = await scan(resolvedDir, { quiet: true });
      const diagnostics = flags.errorsOnly
        ? result.diagnostics.filter((d) => d.severity === "error")
        : result.diagnostics;
      if (flags.errorsOnly && diagnostics.length === 0) {
        logger.success("  ✓ No errors to fix. Run without --errors-only to fix warnings.");
        return;
      }
      const maxFiles = parsePositiveInt(flags.maxFiles as string, "max files");
      const fixResult = await runFix(resolvedDir, diagnostics, {
        agentOverride: flags.agent as string,
        unsafeAgentExec: (flags.unsafeAgentExec as boolean) ?? false,
        dryRunPrompt: (flags.dryRunPrompt as boolean) ?? false,
        verifyLevel: flags.verifyLevel as VerificationLevel,
        maxFiles: maxFiles > 0 ? maxFiles : 50,
      });
      if (fixResult?.errorsIncreased || fixResult?.verificationPassed === false)
        process.exitCode = 1;
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
