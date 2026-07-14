import path from "node:path";
import { Command } from "commander";
import { scan } from "../core/scanner.js";
import { buildIgnoreConfigSnippet, buildIgnoreSuggestions } from "../core/ignores.js";
import { logger } from "../output/logger.js";

export const suggestIgnoreCommand = new Command("suggest-ignore")
  .description("Suggest low-risk ignore config entries for likely false-positive diagnostics")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action(async (directory: string, flags: { json?: boolean }) => {
    try {
      const result = await scan(path.resolve(directory), { quiet: true });
      const suggestions = buildIgnoreSuggestions(result.diagnostics);

      if (flags.json) {
        logger.log(
          JSON.stringify(
            {
              count: suggestions.length,
              suggestions,
              config: JSON.parse(buildIgnoreConfigSnippet(suggestions)),
            },
            null,
            2,
          ),
        );
        return;
      }

      logger.log(
        `  ${suggestions.length} diagnostic${suggestions.length === 1 ? "" : "s"} can likely be ignored.`,
      );
      for (const suggestion of suggestions) {
        logger.log(
          `  ${suggestion.confidence}% ${suggestion.diagnostic.rule} ${suggestion.diagnostic.filePath}:${suggestion.diagnostic.line} - ${suggestion.reason}`,
        );
      }
      if (suggestions.length > 0) {
        logger.break();
        logger.log(buildIgnoreConfigSnippet(suggestions));
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
