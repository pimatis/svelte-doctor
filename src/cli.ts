import path from "node:path";
import { Command } from "commander";
import { scan } from "./core/scanner.js";
import { watch } from "./core/watch.js";
import { runDepsCheck } from "./core/deps.js";
import { runFix } from "./agents/fix.js";
import { migrate } from "./core/migrate.js";
import { printTrend } from "./core/history.js";
import { runUpdate } from "./core/update.js";
import { exportDiagnosticsForAi } from "./core/export.js";
import { logger, highlighter } from "./output/logger.js";
import { DEFAULT_COPY_MAX_DIAGNOSTICS, VERSION } from "./constants.js";
import type {
  CopyFormat,
  CopyOutput,
  DeadCodeMode,
  PackageManager,
  ScanOptions,
  UpdateResult,
  VerificationLevel,
} from "./types.js";

const parseDeadCodeMode = (value: string): DeadCodeMode => {
  if (value === "off" || value === "lazy" || value === "full") return value;
  throw new Error(`Invalid dead-code mode "${value}". Use off, lazy, or full.`);
};

const parseVerifyLevel = (value: string): VerificationLevel => {
  if (value === "diagnostics" || value === "typecheck" || value === "tests" || value === "full") {
    return value;
  }
  throw new Error(`Invalid verify level "${value}". Use diagnostics, typecheck, tests, or full.`);
};

const parsePackageManager = (value: string): PackageManager => {
  if (value === "npm" || value === "pnpm" || value === "bun") return value;
  throw new Error(`Invalid package manager "${value}". Use npm, pnpm, or bun.`);
};

const parseCopyOutput = (value: string): CopyOutput => {
  if (value === "clipboard" || value === "stdout" || value === "file") return value;
  throw new Error(`Invalid copy output "${value}". Use clipboard, stdout, or file.`);
};

const parseCopyFormat = (value: string): CopyFormat => {
  if (value === "prompt" || value === "raw") return value;
  throw new Error(`Invalid copy format "${value}". Use prompt or raw.`);
};

const printUpdateResult = (result: UpdateResult, json: boolean): void => {
  if (json) {
    logger.log(JSON.stringify(result, null, 2));
    return;
  }

  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor update")} v${VERSION}`);
  logger.break();
  logger.log(`  Current: ${highlighter.info(result.currentVersion)}`);
  logger.log(`  Latest:  ${highlighter.info(result.latestVersion)}`);
  logger.log(`  Manager: ${highlighter.info(result.manager)}`);
  logger.log(`  Command: ${highlighter.dim(result.installCommand.join(" "))}`);
  logger.break();

  if (result.alreadyLatest) {
    logger.success("  ✓ Already up to date.");
    logger.break();
    return;
  }

  if (result.dryRun) {
    logger.dim("  Dry run only. No update was installed.");
    logger.break();
    return;
  }

  if (result.updated) {
    logger.success(`  ✓ Updated from ${result.currentVersion} to ${result.latestVersion}.`);
    logger.break();
  }
};

const program = new Command()
  .name("svelte-doctor")
  .description("Diagnose and fix your Svelte codebase")
  .version(VERSION, "-v, --version", "display the version number")
  .addHelpText("after", `
Examples:
  $ svelte-doctor check                 Scan current directory
  $ svelte-doctor check ./my-app        Scan a specific project
  $ svelte-doctor check --no-cache      Force a cold scan
  $ svelte-doctor check --copy          Copy diagnostics for another AI agent
  $ svelte-doctor check --json          Output machine-readable JSON (for AI agents)
  $ svelte-doctor check --score         Output only the numeric score (for CI)
  $ svelte-doctor fix                   Auto-fix issues with an AI agent
  $ svelte-doctor fix --dry-run-prompt  Preview the secure agent prompt
  $ svelte-doctor fix --agent cursor    Use Cursor CLI (agent)
  $ svelte-doctor fix --agent claude    Use a specific agent
  $ svelte-doctor update                Update the global CLI from npm
  $ svelte-doctor update --check        Check for a newer npm release
  $ svelte-doctor migrate               Auto-migrate Svelte 4 → Svelte 5
  $ svelte-doctor migrate --dry-run     Preview changes without modifying
  $ svelte-doctor watch                 Watch for changes and show live score
  $ svelte-doctor watch --dead-code lazy  Re-run dead code lazily in watch mode

Exit Codes:
  0  No errors found
  1  One or more errors found, or fatal failure

AI Agent Integration:
  svelte-doctor is designed to work with AI coding agents.
  Use --json for structured output that agents can parse.
  Use "svelte-doctor fix" to send diagnostics directly to an agent.
  Supported agents: Cursor (agent), Amp, Claude Code, Codex (auto-detected from PATH).
`);

// -- check command --
const checkCommand = new Command("check")
  .description("Scan your project for issues and output a health score")
  .argument("[directory]", "project directory to scan", ".")
  .option("--no-lint", "skip lint rules")
  .option("--no-dead-code", "skip dead code detection")
  .option("--no-cache", "disable scan cache for this run")
  .option("--score", "output only the numeric score (CI mode)")
  .option("--json", "output machine-readable JSON (for AI agents and scripts)")
  .option("--copy", "export diagnostics in an AI-friendly format")
  .option("--copy-output <target>", "copy target: clipboard, stdout, or file", parseCopyOutput, "clipboard")
  .option("--copy-file <path>", "write AI export to a file inside the scanned project root")
  .option("--copy-max <count>", "maximum diagnostics to include in copy/export output", String(DEFAULT_COPY_MAX_DIAGNOSTICS))
  .option("--copy-errors-only", "export only error diagnostics in copy/export output")
  .option("--copy-format <format>", "copy format: prompt or raw", parseCopyFormat, "prompt")
  .addHelpText("after", `
Examples:
  $ svelte-doctor check
  $ svelte-doctor check ./my-app
  $ svelte-doctor check --copy
  $ svelte-doctor check --copy --copy-errors-only
  $ svelte-doctor check --copy --copy-output stdout
  $ svelte-doctor check --copy --copy-output file --copy-file .svelte-doctor/diagnostics.txt
  $ svelte-doctor check --json | jq '.diagnostics[] | select(.severity == "error")'
  $ svelte-doctor check --score
  $ svelte-doctor check --no-dead-code
`)
  .action(async (directory: string, flags: {
    lint: boolean;
    deadCode: boolean;
    cache: boolean;
    score: boolean;
    json: boolean;
    copy?: boolean;
    copyOutput: CopyOutput;
    copyFile?: string;
    copyMax: string;
    copyErrorsOnly?: boolean;
    copyFormat: CopyFormat;
  }) => {
    try {
      const resolvedDir = path.resolve(directory);
      if (flags.copy && (flags.json || flags.score) && flags.copyOutput !== "file") {
        throw new Error("Use --copy-output file when combining --copy with --json or --score.");
      }

      if (!flags.score && !flags.json) {
        logger.break();
        logger.log(`  ${highlighter.bold("svelte-doctor")} v${VERSION}`);
        logger.break();
      }

      const options: ScanOptions = {
        lint: flags.lint,
        deadCode: flags.deadCode,
        cache: flags.cache,
        scoreOnly: flags.score,
        json: flags.json,
      };

      const result = await scan(resolvedDir, options);
      const parsedCopyMax = parseInt(flags.copyMax, 10);

      if (flags.copy) {
        const exportResult = await exportDiagnosticsForAi(resolvedDir, result.diagnostics, {
          enabled: true,
          output: flags.copyOutput,
          filePath: flags.copyFile,
          maxDiagnostics: Number.isFinite(parsedCopyMax) && parsedCopyMax > 0
            ? parsedCopyMax
            : DEFAULT_COPY_MAX_DIAGNOSTICS,
          errorsOnly: flags.copyErrorsOnly ?? false,
          format: flags.copyFormat,
        });

        if (!flags.score && !flags.json) {
          if (exportResult.output === "clipboard") {
            logger.success(`  ✓ Copied ${exportResult.diagnosticsIncluded} diagnostic(s) to the clipboard.`);
          } else if (exportResult.output === "stdout-fallback") {
            logger.warn("  Clipboard unavailable. Printed AI export to stdout instead.");
          } else if (exportResult.output === "stdout") {
            logger.success(`  ✓ Printed ${exportResult.diagnosticsIncluded} diagnostic(s) to stdout.`);
          } else if (exportResult.output === "file" && exportResult.filePath) {
            logger.success(`  ✓ Wrote AI export to ${exportResult.filePath}`);
          }
        }
      }

      if (result.diagnostics.some((d) => d.severity === "error")) {
        process.exitCode = 1;
      }
    } catch (error) {
      if (flags.json) {
        logger.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
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
  .description("Use an AI agent (Cursor/amp/claude/codex) to auto-fix all reported issues")
  .argument("[directory]", "project directory", ".")
  .option("--agent <name>", "force a specific agent (cursor, amp, claude, codex)")
  .option("--errors-only", "fix only errors first (reduces cascade risk, run again for warnings)")
  .option("--unsafe-agent-exec", "allow agent-specific privileged execution flags (opt-in only)")
  .option("--dry-run-prompt", "write the agent prompt to a secure temp file without spawning an agent")
  .option("--verify-level <level>", "verification depth: diagnostics, typecheck, tests, or full", parseVerifyLevel, "diagnostics")
  .option("--max-files <count>", "maximum diagnostics to include in a single agent batch", "50")
  .addHelpText("after", `
Examples:
  $ svelte-doctor fix
  $ svelte-doctor fix ./my-app
  $ svelte-doctor fix --agent cursor
  $ svelte-doctor fix --agent claude
  $ svelte-doctor fix --dry-run-prompt
  $ svelte-doctor fix --verify-level full
  $ svelte-doctor fix --unsafe-agent-exec

Supported Agents (checked in this priority order):
  cursor   Cursor     https://cursor.com/cli (installs as 'agent')
  amp      Amp        https://ampcode.com/
  claude   Claude Code  https://docs.anthropic.com/en/docs/claude-code
  codex    Codex      https://github.com/openai/codex

Security:
  Agent execution is safe-by-default.
  Privileged agent flags are disabled unless you pass --unsafe-agent-exec.

Tip: Use --errors-only to fix critical issues first and reduce cascade errors.
`)
  .action(async (directory: string, flags: {
    agent?: string;
    errorsOnly?: boolean;
    unsafeAgentExec?: boolean;
    dryRunPrompt?: boolean;
    verifyLevel: VerificationLevel;
    maxFiles: string;
  }) => {
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

      const parsedMaxFiles = parseInt(flags.maxFiles, 10);
      const fixResult = await runFix(resolvedDir, diagnostics, {
        agentOverride: flags.agent,
        unsafeAgentExec: flags.unsafeAgentExec ?? false,
        dryRunPrompt: flags.dryRunPrompt ?? false,
        verifyLevel: flags.verifyLevel,
        maxFiles: Number.isFinite(parsedMaxFiles) && parsedMaxFiles > 0 ? parsedMaxFiles : 50,
      });
      if (fixResult?.errorsIncreased || fixResult?.verificationPassed === false) {
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
  .option("--dead-code <mode>", "dead code mode: off, lazy, or full", parseDeadCodeMode, "off")
  .addHelpText("after", `
Examples:
  $ svelte-doctor watch
  $ svelte-doctor watch ./my-app
  $ svelte-doctor watch --dead-code lazy
`)
  .action(async (directory: string, flags: { deadCode: DeadCodeMode }) => {
    try {
      const resolvedDir = path.resolve(directory);
      await watch(resolvedDir, flags.deadCode);
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
        logger.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
        process.exit(1);
        return;
      }

      if (error instanceof Error) {
        logger.error(`  Error: ${error.message}`);
      }
      process.exit(1);
    }
  });

// -- update command --
const updateCommand = new Command("update")
  .description("Check npm for the latest svelte-doctor version and update the global CLI")
  .option("--check", "check for updates without installing")
  .option("--dry-run", "print the global install command without running it")
  .option("--manager <name>", "override package manager (npm, pnpm, bun)", parsePackageManager)
  .option("--tag <name>", "release tag to install", "latest")
  .option("--json", "output machine-readable JSON")
  .addHelpText("after", `
Examples:
  $ svelte-doctor update
  $ svelte-doctor update --check
  $ svelte-doctor update --dry-run
  $ svelte-doctor update --manager npm
`)
  .action(async (flags: {
    check?: boolean;
    dryRun?: boolean;
    manager?: PackageManager;
    tag: string;
    json?: boolean;
  }) => {
    try {
      if (flags.tag !== "latest") {
        throw new Error(`Unsupported tag "${flags.tag}". Only "latest" is supported.`);
      }

      const result = await runUpdate({
        checkOnly: flags.check ?? false,
        dryRun: flags.dryRun ?? false,
        manager: flags.manager,
        tag: "latest",
        json: flags.json ?? false,
      });

      printUpdateResult(result, flags.json ?? false);
    } catch (error) {
      if (flags.json) {
        logger.log(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }));
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
program.addCommand(updateCommand);
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
