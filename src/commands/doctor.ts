import path from "node:path";
import { Command } from "commander";
import { runDoctor } from "../core/doctor.js";
import { logger, highlighter } from "../output/logger.js";
import { VERSION } from "../constants.js";
import type { DoctorCheckResult } from "../core/doctor.js";

const STATUS_ICONS: Record<string, string> = {
  pass: highlighter.success("✓"),
  warning: highlighter.warn("⚠"),
  fail: highlighter.error("✗"),
  na: highlighter.dim("−"),
};

const printDoctorReport = (
  checks: DoctorCheckResult[],
  passed: number,
  warnings: number,
  failed: number,
  notApplicable: number,
) => {
  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor doctor")} v${VERSION}`);
  logger.break();

  for (const check of checks) {
    const icon = STATUS_ICONS[check.status] ?? "?";
    const line = `  ${icon} ${highlighter.bold(check.name.padEnd(24))} ${check.message}`;
    logger.log(line);
    if (check.detail) {
      logger.log(`    ${highlighter.dim(check.detail)}`);
    }
  }

  logger.break();
  const summaryParts = [
    `${highlighter.success(`${passed} passed`)}`,
    `${highlighter.warn(`${warnings} warning${warnings === 1 ? "" : "s"}`)}`,
    `${highlighter.error(`${failed} failed`)}`,
    `${highlighter.dim(`${notApplicable} not applicable`)}`,
  ];
  logger.log(`  Summary: ${summaryParts.join(", ")}`);
  logger.break();
};

export const doctorCommand = new Command("doctor")
  .description("Check your development environment for common issues")
  .argument("[directory]", "project directory to check", ".")
  .option("--json", "output machine-readable JSON")
  .action(async (directory: string, flags: Record<string, unknown>) => {
    try {
      const resolvedDir = path.resolve(directory);
      const result = await runDoctor(resolvedDir);

      if (result.failed > 0) {
        process.exitCode = 1;
      }

      if (flags.json) {
        logger.log(
          JSON.stringify(
            {
              version: VERSION,
              directory: resolvedDir,
              checks: result.checks,
              summary: {
                passed: result.passed,
                warnings: result.warnings,
                failed: result.failed,
                notApplicable: result.notApplicable,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      printDoctorReport(
        result.checks,
        result.passed,
        result.warnings,
        result.failed,
        result.notApplicable,
      );
    } catch (error) {
      if (flags.json) {
        logger.log(
          JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
        );
        process.exit(1);
        return;
      }
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
