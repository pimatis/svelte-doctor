import path from "node:path";
import { Command } from "commander";
import { auditRenderedHtml } from "../core/a11y-runtime.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { validateDirectory } from "../fs/validate.js";

export const a11yRuntimeCommand = new Command("a11y-runtime")
  .description("Audit rendered HTML for accessibility issues (axe-compatible checks)")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action((directory: string, flags: { json?: boolean }) => {
    try {
      const resolvedDirectory = path.resolve(directory);
      validateDirectory(resolvedDirectory);

      const result = auditRenderedHtml(resolvedDirectory);

      if (flags.json) {
        logger.json(
          JSON.stringify(
            {
              files: result.files,
              checks: result.checks,
              truncatedFiles: result.truncatedFiles,
              errors: result.errorCount,
              warnings: result.warningCount,
              diagnostics: result.diagnostics.map((diagnostic) => ({
                rule: diagnostic.rule,
                file: diagnostic.filePath,
                line: diagnostic.line,
                column: diagnostic.column,
                severity: diagnostic.severity,
                message: diagnostic.message,
                help: diagnostic.help,
              })),
            },
            null,
            2,
          ),
        );
        return;
      }

      if (result.files.length === 0) {
        logger.dim("  No rendered HTML found to audit.");
        logger.dim("  Build the project first (the audit reads .svelte-kit/output or build/).");
        logger.break();
        return;
      }

      logger.log(
        highlighter.bold(
          `  Rendered a11y audit: ${result.diagnostics.length} issue${result.diagnostics.length === 1 ? "" : "s"} across ${result.files.length} HTML file${result.files.length === 1 ? "" : "s"}`,
        ),
      );
      for (const file of result.truncatedFiles) {
        logger.dim(
          `  Note: markup in ${sanitize(file)} nests deeper than the audit limit, so it was truncated.`,
        );
      }
      logger.break();

      for (const check of result.checks) {
        if (check.violations === 0) continue;
        logger.log(
          `  ${highlighter.warn(String(check.violations))} ${highlighter.bold(check.rule)} ${highlighter.dim(`(axe: ${check.axeRule})`)}`,
        );
        logger.dim(`    ${sanitize(check.description)}`);
      }

      if (result.diagnostics.length > 0) {
        logger.break();
        for (const diagnostic of result.diagnostics.slice(0, 50)) {
          logger.log(
            `  ${highlighter.warn("⚠")} ${sanitize(diagnostic.message)} ${highlighter.dim(`${diagnostic.filePath}:${diagnostic.line}`)}`,
          );
        }
      }

      logger.break();
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
