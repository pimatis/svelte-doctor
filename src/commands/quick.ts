import { Command } from "commander";
import { runQuick } from "../core/quick.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { VERSION } from "../constants.js";

export const quickCommand = new Command("quick")
  .description("Fast scan showing only errors — quick health check")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--score", "output only the numeric score")
  .action(async (directory: string, flags: { json?: boolean; score?: boolean }) => {
    try {
      const result = await runQuick(directory);
      if (flags.json) { logger.log(JSON.stringify(result, null, 2)); return; }
      if (flags.score) { logger.log(String(result.score)); return; }
      logger.break(); logger.log(`  ${highlighter.bold("svelte-doctor quick")} v${VERSION}`); logger.break();
      const scoreColor = result.score >= 75 ? highlighter.success : result.score >= 50 ? highlighter.warn : highlighter.error;
      logger.log(`  Score: ${scoreColor(String(result.score))} / 100  ${result.label}`);
      logger.log(`  Errors: ${highlighter.error(String(result.errorCount))}  Files: ${result.totalFiles}  ${(result.elapsedMs / 1000).toFixed(1)}s`);
      logger.break();
      if (result.topErrors.length > 0) { logger.log(`  ${highlighter.bold("Top errors:")}`); logger.break(); for (const d of result.topErrors) { logger.error(`    ${sanitize(d.filePath)}:${d.line}  ${sanitize(d.message)}`); logger.dim(`      rule: ${sanitize(d.rule)}`); } logger.break(); } else { logger.success("  ✓ No errors found."); logger.break(); }
    } catch (error) { if (error instanceof Error) logger.error(`  Error: ${error.message}`); process.exit(1); }
  });
