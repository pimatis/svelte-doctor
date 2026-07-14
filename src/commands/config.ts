import { Command } from "commander";
import { viewConfig } from "../core/config-view.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { VERSION } from "../constants.js";
import { infoSafe, warnSafe } from "./utils.js";

export const configCommand = new Command("config")
  .description("Show the active svelte-doctor configuration")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--path", "show only the config file path")
  .action((directory: string, flags: { json?: boolean; path?: boolean }) => {
    try {
      const result = viewConfig(directory);
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }
      if (flags.path) {
        logger.log(result.source ? sanitize(result.source) : "No config file found");
        return;
      }
      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor config")} v${VERSION}`);
      logger.break();
      if (!result.found) {
        logger.dim("  No configuration found.");
        logger.dim(
          '  Create svelte-doctor.config.json or add a "svelte-doctor" key to package.json.',
        );
        logger.break();
        return;
      }
      logger.log(`  Source: ${infoSafe(result.source ?? "unknown")}`);
      logger.break();
      const config = result.config!;
      if (config.lint !== undefined) logger.log(`  lint: ${highlighter.info(String(config.lint))}`);
      if (config.deadCode !== undefined)
        logger.log(`  deadCode: ${highlighter.info(String(config.deadCode))}`);
      if (config.cache !== undefined)
        logger.log(`  cache: ${highlighter.info(String(config.cache))}`);
      if (config.watch) logger.log(`  watch.deadCode: ${infoSafe(config.watch.deadCode ?? "off")}`);
      if (config.fix) {
        if (config.fix.verifyLevel)
          logger.log(`  fix.verifyLevel: ${infoSafe(config.fix.verifyLevel)}`);
        if (config.fix.maxFiles)
          logger.log(`  fix.maxFiles: ${highlighter.info(String(config.fix.maxFiles))}`);
      }
      if (config.reports) {
        if (config.reports.html) logger.log(`  reports.html: ${infoSafe(config.reports.html)}`);
        if (config.reports.junit) logger.log(`  reports.junit: ${infoSafe(config.reports.junit)}`);
        if (config.reports.markdown)
          logger.log(`  reports.markdown: ${infoSafe(config.reports.markdown)}`);
      }
      if (config.ignore) {
        if (config.ignore.rules?.length)
          logger.log(`  ignore.rules: ${warnSafe(config.ignore.rules.join(", "))}`);
        if (config.ignore.files?.length)
          logger.log(`  ignore.files: ${warnSafe(config.ignore.files.join(", "))}`);
      }
      logger.break();
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
