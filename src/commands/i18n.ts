import path from "node:path";
import { Command } from "commander";
import { analyzeI18n } from "../core/i18n.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { validateDirectory } from "../fs/validate.js";
import { loadConfig } from "../project/config.js";

export const i18nCommand = new Command("i18n")
  .description("Check translation catalog completeness against keys used in code")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action((directory: string, flags: { json?: boolean }) => {
    try {
      const resolvedDirectory = path.resolve(directory);
      validateDirectory(resolvedDirectory);

      const config = loadConfig(resolvedDirectory)?.i18n ?? null;
      const result = analyzeI18n(resolvedDirectory, config);

      if (flags.json) {
        logger.json(
          JSON.stringify(
            {
              detected: result.detected,
              locales: result.locales,
              baseLocale: result.baseLocale,
              catalogs: result.catalogs.map((catalog) => ({
                locale: catalog.locale,
                file: catalog.file,
                keys: catalog.keyCount,
              })),
              usedKeys: new Set(result.usages.map((usage) => usage.key)).size,
              missing: result.missing,
              untranslated: result.untranslated,
              unused: result.unused,
            },
            null,
            2,
          ),
        );
        return;
      }

      if (!result.detected) {
        logger.dim("  No translation catalogs found.");
        logger.dim("  Point `i18n.dirs` at your message files in svelte-doctor.config.json.");
        logger.break();
        return;
      }

      logger.log(
        highlighter.bold(
          `  i18n report: ${result.locales.length} locale${result.locales.length === 1 ? "" : "s"} (base: ${result.baseLocale})`,
        ),
      );
      logger.break();

      for (const catalog of result.catalogs) {
        logger.log(
          `  ${catalog.locale.padEnd(8)} ${String(catalog.keyCount).padStart(5)} keys  ${highlighter.dim(catalog.file)}`,
        );
      }
      logger.break();

      logger.log(`  Missing keys (used in code, absent from base): ${result.missing.length}`);
      for (const item of result.missing.slice(0, 10)) {
        logger.log(
          `    ${highlighter.error("✗")} ${sanitize(item.key)} ${highlighter.dim(`${item.file}:${item.line}`)}`,
        );
      }

      logger.log(`  Untranslated keys (absent from another locale): ${result.untranslated.length}`);
      for (const item of result.untranslated.slice(0, 10)) {
        logger.log(
          `    ${highlighter.warn("⚠")} ${sanitize(item.key)} ${highlighter.dim(`-> ${item.locale}`)}`,
        );
      }

      logger.log(`  Unused keys (defined but never referenced): ${result.unused.length}`);
      for (const item of result.unused.slice(0, 10)) {
        logger.log(
          `    ${highlighter.dim("·")} ${sanitize(item.key)} ${highlighter.dim(item.file)}`,
        );
      }
      logger.break();
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
