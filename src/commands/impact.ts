import path from "node:path";
import { Command } from "commander";
import { estimateBundleImpact, summarizeBundleImpact } from "../core/impact.js";
import { evaluateBudget } from "../core/budget.js";
import { scan } from "../core/scanner.js";
import { logger } from "../output/logger.js";
import { loadConfig } from "../project/config.js";

export const bundleImpactCommand = new Command("bundle-impact")
  .description("Estimate bundle savings for fixable bundle-size diagnostics")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--budget <kb>", "fail when measured JavaScript output exceeds this budget in kilobytes")
  .option("--gzip", "measure gzip size for the budget gate")
  .action(async (directory: string, flags: { json?: boolean; budget?: string; gzip?: boolean }) => {
    try {
      const resolvedDirectory = path.resolve(directory);
      const result = await scan(resolvedDirectory, { quiet: true });
      const items = estimateBundleImpact(result.diagnostics);
      const summary = summarizeBundleImpact(items);

      const configured = loadConfig(resolvedDirectory)?.budgets ?? null;
      const budgetKilobytes = flags.budget
        ? Number(flags.budget)
        : (configured?.javascript ?? null);
      if (flags.budget && (!Number.isFinite(budgetKilobytes) || (budgetKilobytes as number) <= 0)) {
        throw new Error(
          `Invalid budget "${flags.budget}". Expected a positive number of kilobytes.`,
        );
      }

      const hasBudget =
        typeof budgetKilobytes === "number" &&
        Number.isFinite(budgetKilobytes) &&
        budgetKilobytes > 0;
      const budgetResult = hasBudget
        ? evaluateBudget(resolvedDirectory, {
            javascript: budgetKilobytes as number,
            gzip: flags.gzip ?? configured?.gzip ?? false,
          })
        : null;

      const measured = budgetResult?.measurement ?? null;

      if (flags.json) {
        logger.json(
          JSON.stringify(
            {
              summary,
              items,
              budget: hasBudget
                ? {
                    limitKilobytes: budgetKilobytes,
                    gzip: measured?.gzip ?? false,
                    measured: measured !== null,
                    javascriptKilobytes: measured
                      ? Math.round((measured.javascriptBytes / 1024) * 10) / 10
                      : null,
                    violations: budgetResult?.violations ?? [],
                  }
                : null,
            },
            null,
            2,
          ),
        );

        if (budgetResult && !budgetResult.withinBudget) process.exit(1);
        return;
      }

      logger.log(`  Potential bundle savings: ${summary.totalKilobytes}KB`);
      for (const item of items) {
        logger.log(`  ${item.rule} ${item.file}:${item.line} ~${item.estimatedKilobytes}KB`);
      }

      if (budgetResult && hasBudget) {
        logger.break();
        if (!measured) {
          logger.dim("  No build output found, so the budget gate was not evaluated.");
        } else {
          const actual = Math.round((measured.javascriptBytes / 1024) * 10) / 10;
          logger.log(
            `  JavaScript budget: ${actual}KB / ${budgetKilobytes}KB${measured.gzip ? " (gzip)" : ""}`,
          );
          if (!budgetResult.withinBudget) {
            logger.error(`  ✗ JavaScript budget exceeded: ${actual}KB > ${budgetKilobytes}KB`);
            logger.break();
            process.exit(1);
          }
          logger.log("  ✓ Within budget.");
        }
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
