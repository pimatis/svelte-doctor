import path from "node:path";
import { Command } from "commander";
import { evaluateBudget } from "../core/budget.js";
import type { BudgetConfig } from "../types.js";
import { logger, highlighter } from "../output/logger.js";
import { validateDirectory } from "../fs/validate.js";
import { loadConfig } from "../project/config.js";

const parseKilobytes = (value: string, field: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${field} budget "${value}". Expected a positive number of kilobytes.`);
  }
  return parsed;
};

const formatKilobytes = (bytes: number): string => `${Math.round((bytes / 1024) * 10) / 10}KB`;

export const budgetCommand = new Command("budget")
  .description("Measure build output against bundle size budgets")
  .argument("[directory]", "project directory", ".")
  .option("--js <kb>", "JavaScript budget in kilobytes")
  .option("--css <kb>", "CSS budget in kilobytes")
  .option("--chunk <kb>", "largest single chunk budget in kilobytes")
  .option("--gzip", "measure gzip size instead of raw bytes")
  .option("--json", "output machine-readable JSON")
  .action(
    (
      directory: string,
      flags: { js?: string; css?: string; chunk?: string; gzip?: boolean; json?: boolean },
    ) => {
      try {
        const resolvedDirectory = path.resolve(directory);
        validateDirectory(resolvedDirectory);

        const configured = loadConfig(resolvedDirectory)?.budgets ?? null;
        const budgets: BudgetConfig = {
          javascript: flags.js ? parseKilobytes(flags.js, "js") : configured?.javascript,
          css: flags.css ? parseKilobytes(flags.css, "css") : configured?.css,
          chunk: flags.chunk ? parseKilobytes(flags.chunk, "chunk") : configured?.chunk,
          gzip: flags.gzip ?? configured?.gzip ?? false,
        };

        const result = evaluateBudget(resolvedDirectory, budgets);

        if (!result.measurement) {
          if (flags.json) {
            logger.json(
              JSON.stringify(
                {
                  measured: false,
                  withinBudget: true,
                  violations: [],
                  message: "No build output found",
                },
                null,
                2,
              ),
            );
            return;
          }
          logger.dim("  No build output found (run your build first).");
          logger.break();
          return;
        }

        const measurement = result.measurement;

        if (flags.json) {
          logger.json(
            JSON.stringify(
              {
                measured: true,
                gzip: measurement.gzip,
                roots: measurement.roots,
                javascriptBytes: measurement.javascriptBytes,
                cssBytes: measurement.cssBytes,
                largestChunkBytes: measurement.largestChunkBytes,
                largestChunkFile: measurement.largestChunkFile,
                totalBytes: measurement.totalBytes,
                assetCount: measurement.assets.length,
                withinBudget: result.withinBudget,
                violations: result.violations,
              },
              null,
              2,
            ),
          );
          // the JSON mode is the CI entry point, so the gate must still fail the build
          if (!result.withinBudget) process.exit(1);
          return;
        }

        logger.log(
          highlighter.bold(
            `  Bundle budget report${measurement.gzip ? " (gzip)" : ""} [${measurement.roots.join(", ")}]`,
          ),
        );
        logger.break();

        const rows: Array<[string, number, number | undefined, string]> = [
          ["JavaScript", measurement.javascriptBytes, budgets.javascript, "javascript"],
          ["CSS", measurement.cssBytes, budgets.css, "css"],
          ["Largest chunk", measurement.largestChunkBytes, budgets.chunk, "chunk"],
        ];

        for (const [label, bytes, limit, key] of rows) {
          const violation = result.violations.find((item) => item.budget === key);
          const status =
            limit === undefined
              ? highlighter.dim("no budget")
              : violation
                ? highlighter.error("OVER")
                : highlighter.success("ok");
          const limitLabel = limit === undefined ? "" : ` / ${limit}KB`;
          logger.log(
            `  ${label.padEnd(14)} ${formatKilobytes(bytes).padStart(10)}${limitLabel}  ${status}`,
          );
        }

        logger.break();
        logger.log(
          `  ${measurement.assets.length} assets, ${formatKilobytes(measurement.totalBytes)} total`,
        );
        if (measurement.largestChunkFile) {
          logger.dim(`  Largest chunk: ${measurement.largestChunkFile}`);
        }
        logger.break();

        if (!result.withinBudget) {
          for (const violation of result.violations) {
            logger.error(
              `  ✗ ${violation.budget} budget exceeded: ${violation.actualKilobytes}KB > ${violation.limitKilobytes}KB (${violation.filePath})`,
            );
          }
          logger.break();
          process.exit(1);
        }

        logger.success("  ✓ Build output is within budget.");
        logger.break();
      } catch (error) {
        if (error instanceof Error) logger.error(`  Error: ${error.message}`);
        process.exit(1);
      }
    },
  );
