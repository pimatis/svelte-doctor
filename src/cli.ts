import { Command } from "commander";
import { VERSION } from "./constants.js";
import { logger } from "./output/logger.js";
import { checkCommand } from "./commands/check.js";
import { baselineCommand } from "./commands/baseline.js";
import { applyCommand } from "./commands/apply.js";
import { rulesCommand } from "./commands/rules.js";
import { explainCommand } from "./commands/explain.js";
import { fixCommand } from "./commands/fix.js";
import { watchCommand } from "./commands/watch.js";
import { depsCommand } from "./commands/deps.js";
import { initCommand } from "./commands/init.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { prCheckCommand } from "./commands/pr-check.js";
import { updateCommand } from "./commands/update.js";
import { trendCommand } from "./commands/trend.js";
import { migrateCommand } from "./commands/migrate.js";
import { configCommand } from "./commands/config.js";
import { validateCommand } from "./commands/validate.js";
import { quickCommand } from "./commands/quick.js";
import { statsCommand } from "./commands/stats.js";
import { auditCommand } from "./commands/audit.js";
import { compareCommand } from "./commands/compare.js";

const program = new Command()
  .name("svelte-doctor")
  .description("Diagnose and fix your Svelte codebase")
  .version(VERSION, "-v, --version", "display the version number");

program
  .addCommand(initCommand)
  .addCommand(checkCommand)
  .addCommand(baselineCommand)
  .addCommand(applyCommand)
  .addCommand(rulesCommand)
  .addCommand(explainCommand)
  .addCommand(fixCommand)
  .addCommand(watchCommand)
  .addCommand(trendCommand)
  .addCommand(depsCommand)
  .addCommand(upgradeCommand)
  .addCommand(prCheckCommand)
  .addCommand(updateCommand)
  .addCommand(migrateCommand)
  .addCommand(configCommand)
  .addCommand(validateCommand)
  .addCommand(quickCommand)
  .addCommand(statsCommand)
  .addCommand(auditCommand)
  .addCommand(compareCommand);

const main = async () => {
  const args = process.argv.slice(2);
  const hasGlobalFlag = args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v");
  const subcommands = program.commands.map((cmd) => cmd.name());
  const firstArg = args.find((arg) => !arg.startsWith("-"));
  const hasSubcommand = firstArg && subcommands.includes(firstArg);

  try {
    if (hasGlobalFlag || hasSubcommand) {
      await program.parseAsync();
      return;
    }

    await checkCommand.parseAsync(args, { from: "user" });
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`  Error: ${error.message}`);
    }
    process.exit(1);
  }
};

main();
