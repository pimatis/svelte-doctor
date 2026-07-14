import { spawnSync } from "node:child_process";
import path from "node:path";
import { Command } from "commander";
import { PLUGIN_CATALOG, findCatalogEntry, searchCatalog } from "../plugins/catalog.js";
import { resolvePackageManager } from "../core/runtime.js";
import { logger, highlighter } from "../output/logger.js";

const installCommand = (manager: string, pkg: string): string[] => {
  if (manager === "bun") return ["bun", "add", "-d", pkg];
  if (manager === "pnpm") return ["pnpm", "add", "-D", pkg];
  if (manager === "yarn") return ["yarn", "add", "-D", pkg];
  return ["npm", "install", "-D", pkg];
};

export const registryCommand = new Command("registry")
  .description("Browse the central svelte-doctor plugin catalog")
  .addCommand(
    new Command("list")
      .description("List plugins in the central catalog")
      .option("--json", "output machine-readable JSON")
      .action((flags: { json?: boolean }) => {
        if (flags.json) {
          logger.log(JSON.stringify(PLUGIN_CATALOG, null, 2));
          return;
        }
        logger.break();
        logger.log(`  ${highlighter.bold("svelte-doctor plugin catalog")}`);
        logger.break();
        for (const entry of PLUGIN_CATALOG) {
          logger.log(`  ${highlighter.info(entry.name)}  ${highlighter.dim(entry.category)}`);
          logger.dim(`    ${entry.description}`);
          logger.dim(`    install: ${entry.package}`);
          logger.break();
        }
        logger.dim(`  Submit new plugins via a pull request to the svelte-doctor repository.`);
        logger.break();
      }),
  )
  .addCommand(
    new Command("search")
      .description("Search the catalog by name, description, or tag")
      .argument("<query>", "search query")
      .option("--json", "output machine-readable JSON")
      .action((query: string, flags: { json?: boolean }) => {
        const matches = searchCatalog(query);
        if (flags.json) {
          logger.log(JSON.stringify(matches, null, 2));
          return;
        }
        if (matches.length === 0) {
          logger.warn(`  No catalog entries match "${query}".`);
          return;
        }
        logger.break();
        for (const entry of matches) {
          logger.log(`  ${highlighter.info(entry.name)}  ${highlighter.dim(entry.category)}`);
          logger.dim(`    ${entry.description}`);
          logger.break();
        }
      }),
  )
  .addCommand(
    new Command("info")
      .description("Show details for a catalog plugin")
      .argument("<name>", "catalog plugin name")
      .option("--json", "output machine-readable JSON")
      .action((name: string, flags: { json?: boolean }) => {
        const entry = findCatalogEntry(name);
        if (!entry) {
          logger.error(`  Unknown catalog plugin: ${name}`);
          process.exit(1);
          return;
        }
        if (flags.json) {
          logger.log(JSON.stringify(entry, null, 2));
          return;
        }
        logger.break();
        logger.log(`  ${highlighter.bold(entry.name)}`);
        logger.break();
        logger.log(`  Package: ${highlighter.info(entry.package)}`);
        logger.log(`  Category: ${entry.category}`);
        logger.log(`  Description: ${entry.description}`);
        if (entry.author) logger.log(`  Author: ${entry.author}`);
        if (entry.repository) logger.log(`  Repository: ${entry.repository}`);
        if (entry.tags?.length) logger.log(`  Tags: ${entry.tags.join(", ")}`);
        logger.break();
        logger.log(`  Install: ${highlighter.info(`svelte-doctor registry add ${entry.name}`)}`);
        logger.break();
      }),
  )
  .addCommand(
    new Command("add")
      .description("Install a catalog plugin with your package manager")
      .argument("<name>", "catalog plugin name")
      .option("--dry-run", "print the install command without running it")
      .action((name: string, flags: { dryRun?: boolean }) => {
        const entry = findCatalogEntry(name);
        if (!entry) {
          logger.error(`  Unknown catalog plugin: ${name}`);
          process.exit(1);
          return;
        }

        const manager = resolvePackageManager(path.resolve("."));
        const args = installCommand(manager, entry.package);

        if (flags.dryRun) {
          logger.log(args.join(" "));
          return;
        }

        logger.break();
        logger.warn("  Security notice: installed plugins execute arbitrary code during scans.");
        logger.dim("    Review the package source before installing and pin an exact version.");
        logger.dim("    Plugins are NOT auto-loaded. After installing, add it to your config:");
        logger.dim(`      { "plugins": { "include": ["${entry.package}"] } }`);
        logger.break();
        logger.log(
          `  Installing ${highlighter.info(entry.package)} with ${highlighter.info(manager)}...`,
        );
        const result = spawnSync(args[0], args.slice(1), {
          cwd: path.resolve("."),
          stdio: "inherit",
          env: process.env,
        });

        if (result.status !== 0) {
          logger.error(`  Installation failed. Run "${args.join(" ")}" manually to see the error.`);
          process.exit(1);
          return;
        }

        logger.success(`  ✓ Installed ${entry.package}.`);
        logger.dim(
          `    Enable it in svelte-doctor.config.json, then run \`svelte-doctor plugins\` to confirm.`,
        );
        logger.break();
      }),
  );
