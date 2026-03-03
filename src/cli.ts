import path from "node:path";
import { Command } from "commander";
import { scan } from "./core/scanner.js";
import { watch } from "./core/watch.js";
import { runDepsCheck } from "./core/deps.js";
import { runFix } from "./agents/fix.js";
import { migrate } from "./core/migrate.js";
import { printTrend } from "./core/history.js";
import { logger, highlighter } from "./output/logger.js";
import { VERSION } from "./constants.js";
import type { ScanOptions } from "./types.js";

const program = new Command()
  .name("svelte-doctor")
  .description("Diagnose and fix your Svelte codebase")
  .version(VERSION, "-v, --version", "display the version number")
  .addHelpText("after", `
Examples:
  $ svelte-doctor check                 Scan current directory
  $ svelte-doctor check ./my-app        Scan a specific project
  $ svelte-doctor check --json          Output machine-readable JSON (for AI agents)
  $ svelte-doctor check --score         Output only the numeric score (for CI)
  $ svelte-doctor fix                   Auto-fix issues with an AI agent
  $ svelte-doctor fix --agent claude    Use a specific agent
  $ svelte-doctor migrate               Auto-migrate Svelte 4 → Svelte 5
  $ svelte-doctor migrate --dry-run     Preview changes without modifying
  $ svelte-doctor watch                 Watch for changes and show live score

Exit Codes:
  0  No errors found
  1  One or more errors found, or fatal failure

AI Agent Integration:
  svelte-doctor is designed to work with AI coding agents.
  Use --json for structured output that agents can parse.
  Use "svelte-doctor fix" to send diagnostics directly to an agent.
  Supported agents: Amp, Claude Code, Codex (auto-detected from PATH).
`);

// -- check command --
const checkCommand = new Command("check")
  .description("Scan your project for issues and output a health score")
  .argument("[directory]", "project directory to scan", ".")
  .option("--no-lint", "skip lint rules")
  .option("--no-dead-code", "skip dead code detection")
  .option("--score", "output only the numeric score (CI mode)")
  .option("--json", "output machine-readable JSON (for AI agents and scripts)")
  .addHelpText("after", `
Examples:
  $ svelte-doctor check
  $ svelte-doctor check ./my-app
  $ svelte-doctor check --json | jq '.diagnostics[] | select(.severity == "error")'
  $ svelte-doctor check --score
  $ svelte-doctor check --no-dead-code
`)
  .action(async (directory: string, flags: { lint: boolean; deadCode: boolean; score: boolean; json: boolean }) => {
    try {
      const resolvedDir = path.resolve(directory);

      if (!flags.score && !flags.json) {
        logger.break();
        logger.log(`  ${highlighter.bold("svelte-doctor")} v${VERSION}`);
        logger.break();
      }

      const options: ScanOptions = {
        lint: flags.lint,
        deadCode: flags.deadCode,
        scoreOnly: flags.score,
        json: flags.json,
      };

      const result = await scan(resolvedDir, options);

      if (result.diagnostics.some((d) => d.severity === "error")) {
        process.exitCode = 1;
      }
    } catch (error) {
      if (flags.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
        process.exit(1);
        return;
      }

      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

// -- fix command --
const fixCommand = new Command("fix")
  .description("Use an AI agent (amp/claude/codex) to auto-fix all reported issues")
  .argument("[directory]", "project directory", ".")
  .option("--agent <name>", "force a specific agent (amp, claude, codex)")
  .option("--errors-only", "fix only errors first (reduces cascade risk, run again for warnings)")
  .addHelpText("after", `
Examples:
  $ svelte-doctor fix
  $ svelte-doctor fix ./my-app
  $ svelte-doctor fix --agent claude

Supported Agents (checked in this priority order):
  amp      Amp        https://ampcode.com/
  claude   Claude Code  https://docs.anthropic.com/en/docs/claude-code
  codex    Codex      https://github.com/openai/codex

Tip: Use --errors-only to fix critical issues first and reduce cascade errors.
`)
  .action(async (directory: string, flags: { agent?: string; errorsOnly?: boolean }) => {
    try {
      const resolvedDir = path.resolve(directory);

      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor fix")} v${VERSION}`);
      logger.break();

      const result = await scan(resolvedDir, {});
      const diagnostics = flags.errorsOnly
        ? result.diagnostics.filter((d) => d.severity === "error")
        : result.diagnostics;
      if (flags.errorsOnly && diagnostics.length === 0) {
        logger.success("  ✓ No errors to fix. Run without --errors-only to fix warnings.");
        return;
      }
      const fixResult = await runFix(resolvedDir, diagnostics, flags.agent);
      if (fixResult?.errorsIncreased) {
        process.exitCode = 1;
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

// -- watch command --
const watchCommand = new Command("watch")
  .description("Watch for file changes and show live diagnostics")
  .argument("[directory]", "project directory", ".")
  .addHelpText("after", `
Examples:
  $ svelte-doctor watch
  $ svelte-doctor watch ./my-app
`)
  .action(async (directory: string) => {
    try {
      const resolvedDir = path.resolve(directory);
      await watch(resolvedDir);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

// -- deps command --
const depsCommand = new Command("deps")
  .description("Check dependency health for Svelte ecosystem compatibility")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .addHelpText("after", `
Examples:
  $ svelte-doctor deps
  $ svelte-doctor deps ./my-app
  $ svelte-doctor deps --json
`)
  .action(async (directory: string, flags: { json: boolean }) => {
    try {
      const resolvedDir = path.resolve(directory);
      runDepsCheck(resolvedDir, flags.json ?? false);
    } catch (error) {
      if (flags.json) {
        console.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
        process.exit(1);
        return;
      }

      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

// -- trend command --
const trendCommand = new Command("trend")
  .description("Show score history and trend over time")
  .argument("[directory]", "project directory", ".")
  .option("-n, --last <count>", "number of recent entries to show", "20")
  .addHelpText("after", `
Examples:
  $ svelte-doctor trend
  $ svelte-doctor trend ./my-app
  $ svelte-doctor trend -n 10
`)
  .action((directory: string, flags: { last: string }) => {
    try {
      const resolvedDir = path.resolve(directory);
      const parsed = parseInt(flags.last, 10);
      const count = Number.isNaN(parsed) || parsed < 1 ? 20 : Math.min(500, parsed);

      printTrend(resolvedDir, count);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

// -- migrate command --
const migrateCommand = new Command("migrate")
  .description("Auto-migrate Svelte 4 syntax to Svelte 5")
  .argument("[directory]", "project directory", ".")
  .option("--dry-run", "show changes without modifying files")
  .option("--no-backup", "skip creating .svelte.bak backup files")
  .addHelpText("after", `
Examples:
  $ svelte-doctor migrate
  $ svelte-doctor migrate ./my-app
  $ svelte-doctor migrate --dry-run
  $ svelte-doctor migrate --no-backup
`)
  .action(async (directory: string, flags: { dryRun: boolean; backup: boolean }) => {
    try {
      const resolvedDir = path.resolve(directory);

      await migrate(resolvedDir, {
        // Commander sets flags.dryRun to true when --dry-run is passed and
        // leaves it undefined otherwise — explicit false fallback is correct here
        dryRun: flags.dryRun === true,
        // Commander sets flags.backup to false when --no-backup is passed and
        // to true when absent (default-true option) — no ?? needed
        backup: flags.backup !== false,
      });
    } catch (error) {
      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

program.addCommand(checkCommand);
program.addCommand(fixCommand);
program.addCommand(watchCommand);
program.addCommand(trendCommand);
program.addCommand(depsCommand);
program.addCommand(migrateCommand);

program.action(() => {
  program.help();
});

const main = async () => {
  try {
    await program.parseAsync();
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`  Error: ${error.message}`);
    }
    process.exit(1);
  }
};

main();
