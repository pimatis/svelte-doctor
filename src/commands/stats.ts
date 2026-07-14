import { Command } from "commander";
import { runStats } from "../core/stats.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { parsePositiveInt, infoSafe } from "./utils.js";

export const statsCommand = new Command("stats")
  .description("Show project metrics: rule frequency, top files, category breakdown")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--top <count>", "number of top items to show", "10")
  .action(async (directory: string, flags: { json?: boolean; top: string }) => {
    try {
      const result = await runStats(directory, parsePositiveInt(flags.top, "top"));
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }
      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor stats")} v${VERSION}`);
      logger.break();
      logger.log(`  Score: ${highlighter.info(String(result.score))} / 100  ${result.label}`);
      logger.log(`  Files: ${result.totalFiles}  Diagnostics: ${result.totalDiagnostics}`);
      logger.log(
        `  Errors: ${highlighter.error(String(result.errorCount))}  Warnings: ${highlighter.warn(String(result.warningCount))}  Fixable: ${highlighter.info(String(result.fixableCount))}`,
      );
      logger.log(
        `  Affected files: ${result.affectedFiles}  ${(result.elapsedMs / 1000).toFixed(1)}s`,
      );
      logger.break();
      if (result.categories.length > 0) {
        logger.log(`  ${highlighter.bold("Categories:")}`);
        for (const c of result.categories)
          logger.log(
            `    ${sanitize(c.category)}: ${c.count} (${c.errors} errors, ${c.warnings} warnings)`,
          );
        logger.break();
      }
      if (result.topRules.length > 0) {
        logger.log(`  ${highlighter.bold("Top rules:")}`);
        for (const r of result.topRules)
          logger.log(`    ${infoSafe(r.rule)}: ${r.count}  [${sanitize(r.category)}]`);
        logger.break();
      }
      if (result.topFiles.length > 0) {
        logger.log(`  ${highlighter.bold("Top files:")}`);
        for (const f of result.topFiles)
          logger.log(`    ${highlighter.warn(String(f.count))}  ${sanitize(f.file)}`);
        logger.break();
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
