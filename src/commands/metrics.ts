import { Command } from "commander";
import { runMetrics, formatDebt } from "../core/metrics.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { parsePositiveInt, infoSafe } from "./utils.js";

const formatMs = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

export const metricsCommand = new Command("metrics")
  .description(
    "Detailed metrics: scan phase durations, per-rule score gains, and technical debt estimate",
  )
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--top <count>", "number of rules to show in the gain table", "15")
  .action(async (directory: string, flags: { json?: boolean; top: string }) => {
    try {
      const result = await runMetrics(directory, parsePositiveInt(flags.top, "top"));

      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }

      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor metrics")} v${VERSION}`);
      logger.break();
      logger.log(
        `  Score: ${highlighter.info(String(result.score))} / 100  ${result.label}`,
      );
      logger.log(
        `  Potential score (all fixes applied): ${highlighter.success(String(result.potentialScore))}  (+${result.totalGain})`,
      );
      logger.log(
        `  Files: ${result.totalFiles}  Diagnostics: ${result.totalDiagnostics}  Errors: ${highlighter.error(String(result.errorCount))}  Warnings: ${highlighter.warn(String(result.warningCount))}  Fixable: ${highlighter.info(String(result.fixableCount))}`,
      );
      logger.break();

      logger.log(`  ${highlighter.bold("Command durations:")}`);
      for (const [phase, ms] of Object.entries(result.phaseTimings))
        logger.log(`    ${sanitize(phase)}: ${highlighter.info(formatMs(ms))}`);
      logger.log(`    total: ${highlighter.info(formatMs(result.elapsedMs))}`);
      logger.break();

      if (result.ruleGains.length > 0) {
        logger.log(
          `  ${highlighter.bold("Rule gains:")} score points gained by fixing each rule alone`,
        );
        for (const r of result.ruleGains)
          logger.log(
            `    +${r.scoreGain}  ${infoSafe(r.rule)}  ${r.count} diagnostic${r.count === 1 ? "" : "s"}  [${sanitize(r.category)}]  ~${r.estimatedMinutes}m`,
          );
        logger.break();
      }

      logger.log(`  ${highlighter.bold("Technical debt estimate:")}`);
      logger.log(
        `    Total: ${highlighter.warn(result.debt.formatted)}  (fixable: ~${formatDebt(result.debt.fixableMinutes)}, manual: ~${formatDebt(result.debt.manualMinutes)})`,
      );
      for (const c of result.debt.byCategory)
        logger.log(`    ${sanitize(c.category)}: ${c.count} diagnostics, ~${formatDebt(c.estimatedMinutes)}`);
      logger.break();
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
