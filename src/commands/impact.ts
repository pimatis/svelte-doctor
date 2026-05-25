import path from "node:path";
import { Command } from "commander";
import { estimateBundleImpact, summarizeBundleImpact } from "../core/impact.js";
import { scan } from "../core/scanner.js";
import { logger } from "../output/logger.js";

export const bundleImpactCommand = new Command("bundle-impact")
  .description("Estimate bundle savings for fixable bundle-size diagnostics")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action(async (directory: string, flags: { json?: boolean }) => {
    try {
      const result = await scan(path.resolve(directory), { quiet: true });
      const items = estimateBundleImpact(result.diagnostics);
      const summary = summarizeBundleImpact(items);

      if (flags.json) {
        logger.log(JSON.stringify({ summary, items }, null, 2));
        return;
      }

      logger.log(`  Potential bundle savings: ${summary.totalKilobytes}KB`);
      for (const item of items) {
        logger.log(`  ${item.rule} ${item.file}:${item.line} ~${item.estimatedKilobytes}KB`);
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
