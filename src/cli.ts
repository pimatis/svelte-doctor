import { Command } from "commander";
import { VERSION } from "./constants.js";
import { logger, setJsonMode } from "./output/logger.js";

// commands are loaded on demand: startup only imports the module for the
// subcommand actually invoked (rolldown splits each into its own chunk)
const commandLoaders: Record<string, () => Promise<Command>> = {
  init: () => import("./commands/init.js").then((m) => m.initCommand),
  check: () => import("./commands/check.js").then((m) => m.checkCommand),
  baseline: () => import("./commands/baseline.js").then((m) => m.baselineCommand),
  apply: () => import("./commands/apply.js").then((m) => m.applyCommand),
  rules: () => import("./commands/rules.js").then((m) => m.rulesCommand),
  explain: () => import("./commands/explain.js").then((m) => m.explainCommand),
  fix: () => import("./commands/fix.js").then((m) => m.fixCommand),
  watch: () => import("./commands/watch.js").then((m) => m.watchCommand),
  trend: () => import("./commands/trend.js").then((m) => m.trendCommand),
  deps: () => import("./commands/deps.js").then((m) => m.depsCommand),
  upgrade: () => import("./commands/upgrade.js").then((m) => m.upgradeCommand),
  "pr-check": () => import("./commands/pr-check.js").then((m) => m.prCheckCommand),
  update: () => import("./commands/update.js").then((m) => m.updateCommand),
  migrate: () => import("./commands/migrate.js").then((m) => m.migrateCommand),
  config: () => import("./commands/config.js").then((m) => m.configCommand),
  validate: () => import("./commands/validate.js").then((m) => m.validateCommand),
  quick: () => import("./commands/quick.js").then((m) => m.quickCommand),
  stats: () => import("./commands/stats.js").then((m) => m.statsCommand),
  metrics: () => import("./commands/metrics.js").then((m) => m.metricsCommand),
  audit: () => import("./commands/audit.js").then((m) => m.auditCommand),
  compare: () => import("./commands/compare.js").then((m) => m.compareCommand),
  doctor: () => import("./commands/doctor.js").then((m) => m.doctorCommand),
  reset: () => import("./commands/reset.js").then((m) => m.resetCommand),
  "suggest-ignore": () => import("./commands/ignores.js").then((m) => m.suggestIgnoreCommand),
  "migrate-status": () => import("./commands/progress.js").then((m) => m.migrateStatusCommand),
  graph: () => import("./commands/graph.js").then((m) => m.graphCommand),
  "bundle-impact": () => import("./commands/impact.js").then((m) => m.bundleImpactCommand),
  "test-gaps": () => import("./commands/coverage.js").then((m) => m.testGapsCommand),
  "create-rule": () => import("./commands/scaffold.js").then((m) => m.createRuleCommand),
  "render-profile": () => import("./commands/profile.js").then((m) => m.renderProfileCommand),
  "install-hook": () => import("./commands/install-hook.js").then((m) => m.installHookCommand),
  "where-used": () => import("./commands/where-used.js").then((m) => m.whereUsedCommand),
  "dead-stores": () => import("./commands/dead-stores.js").then((m) => m.deadStoresCommand),
  plugins: () => import("./commands/plugins.js").then((m) => m.pluginsCommand),
  registry: () => import("./commands/registry.js").then((m) => m.registryCommand),
};

const loadAll = async (program: Command): Promise<void> => {
  await Promise.all(
    Object.values(commandLoaders).map((load) => load().then((cmd) => program.addCommand(cmd))),
  );
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes("--json")) setJsonMode(true);

  const program = new Command()
    .name("svelte-doctor")
    .description("Diagnose and fix your Svelte codebase")
    .version(VERSION, "-v, --version", "display the version number");

  const firstArg = args.find((arg) => !arg.startsWith("-"));
  const hasGlobalFlag = args.some(
    (arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-v",
  );
  const hasSubcommand =
    firstArg !== undefined && (firstArg in commandLoaders || firstArg === "help");

  try {
    if (hasGlobalFlag || firstArg === "help") {
      // help listings and `help <command>` need every command's metadata
      await loadAll(program);
    } else if (hasSubcommand) {
      program.addCommand(await commandLoaders[firstArg]());
    }

    if (hasGlobalFlag || hasSubcommand) {
      await program.parseAsync();
      return;
    }

    // bare or unknown invocation falls through to check, as before
    const checkCommand = await commandLoaders.check();
    await checkCommand.parseAsync(args, { from: "user" });
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`  Error: ${error.message}`);
    }
    process.exit(1);
  }
};

main();
