import { Command } from "commander";
import { runCompare } from "../core/compare.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { infoSafe } from "./utils.js";

export const compareCommand = new Command("compare")
  .description("Compare diagnostics between two git refs (commits, branches)")
  .argument("[directory]", "project directory", ".")
  .option("--base <ref>", "base git ref (commit, branch, tag)", "main")
  .option("--head <ref>", "head git ref", "HEAD")
  .option("--json", "output machine-readable JSON")
  .action(async (directory: string, flags: { base: string; head: string; json?: boolean }) => {
    try {
      const result = await runCompare(directory, flags.base, flags.head);
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }
      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor compare")} v${VERSION}`);
      logger.break();
      logger.log(
        `  Base: ${infoSafe(result.base.ref)}  Score: ${result.base.score}  ${sanitize(result.base.label)}`,
      );
      logger.log(
        `  Head: ${infoSafe(result.head.ref)}  Score: ${result.head.score}  ${sanitize(result.head.label)}`,
      );
      logger.break();
      const delta = result.scoreDelta;
      const deltaStr = delta >= 0 ? `+${delta}` : String(delta);
      const deltaColor =
        delta > 0 ? highlighter.success : delta < 0 ? highlighter.error : highlighter.dim;
      logger.log(`  Delta: ${deltaColor(deltaStr)} points`);
      logger.break();
      if (result.newErrors.length > 0) {
        logger.error(`  New errors (${result.newErrors.length}):`);
        for (const d of result.newErrors)
          logger.error(`    + ${sanitize(d.filePath)}:${d.line}  ${sanitize(d.message)}`);
      }
      if (result.fixedErrors.length > 0) {
        logger.success(`  Fixed errors (${result.fixedErrors.length}):`);
        for (const d of result.fixedErrors)
          logger.success(`    - ${sanitize(d.filePath)}:${d.line}  ${sanitize(d.message)}`);
      }
      if (result.newWarnings.length > 0) {
        logger.warn(`  New warnings (${result.newWarnings.length}):`);
        for (const d of result.newWarnings)
          logger.warn(`    + ${sanitize(d.filePath)}:${d.line}  ${sanitize(d.message)}`);
      }
      if (result.fixedWarnings.length > 0) {
        logger.success(`  Fixed warnings (${result.fixedWarnings.length}):`);
        for (const d of result.fixedWarnings)
          logger.success(`    - ${sanitize(d.filePath)}:${d.line}  ${sanitize(d.message)}`);
      }
      if (
        result.newErrors.length === 0 &&
        result.fixedErrors.length === 0 &&
        result.newWarnings.length === 0 &&
        result.fixedWarnings.length === 0
      )
        logger.dim("  No diagnostic changes between refs.");
      logger.break();
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
