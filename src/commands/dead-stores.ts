import path from "node:path";
import { Command } from "commander";
import { analyzeDeadStores, type DeadStoreReport } from "../core/stores.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { validateDirectory } from "../fs/validate.js";

const formatLocation = (file: string, line: number): string => {
  const location = `${file}:${line}`;
  const padding = " ".repeat(Math.max(2, 36 - location.length));
  return `${location}${padding}`;
};

const formatReads = (reads: DeadStoreReport["reads"]): string => {
  if (reads.length === 0) return "";
  const byKind = new Map<string, DeadStoreReport["reads"]>();
  for (const read of reads) {
    const list = byKind.get(read.kind) ?? [];
    list.push(read);
    byKind.set(read.kind, list);
  }

  const parts: string[] = [];
  for (const [kind, items] of byKind) {
    const label = kind === "auto" ? `$-auto-subscribe` : kind === "subscribe" ? ".subscribe()" : "get()";
    const unique = new Map<string, DeadStoreReport["reads"][number]>();
    for (const item of items) {
      const key = `${item.file}:${item.line}`;
      if (!unique.has(key)) unique.set(key, item);
    }
    parts.push(`  Used in (${label}, ${unique.size}):`);
    for (const item of unique.values()) {
      const prefix = kind === "auto" ? `$` : "";
      parts.push(`    ${formatLocation(item.file, item.line)}${prefix}${sanitize(item.name)}`);
    }
  }
  return parts.join("\n");
};

const formatWrites = (writes: DeadStoreReport["writes"]): string => {
  if (writes.length === 0) return "";
  const unique = new Map<string, DeadStoreReport["writes"][number]>();
  for (const write of writes) {
    const key = `${write.file}:${write.line}:${write.name}`;
    if (!unique.has(key)) unique.set(key, write);
  }

  const parts: string[] = [`  Written in ${unique.size} place${unique.size === 1 ? "" : "s"}:`];
  for (const write of unique.values()) {
    const accessor = write.via === "auto" ? `$${write.name} =` : `${write.name}.${write.method}()`;
    parts.push(`    ${formatLocation(write.file, write.line)}${sanitize(accessor)}`);
  }
  return parts.join("\n");
};

const buildJsonPayload = (result: ReturnType<typeof analyzeDeadStores>) => ({
  totalStores: result.totalStores,
  deadStores: result.deadStores,
  stores: result.stores.map((report) => ({
    name: report.declaration.name,
    kind: report.declaration.kind,
    file: report.declaration.file,
    line: report.declaration.line,
    exported: report.declaration.exported,
    status: report.status,
    suggestion: report.suggestion,
    writes: report.writes.map((w) => ({
      file: w.file,
      line: w.line,
      method: w.method,
      via: w.via,
      snippet: w.snippet,
    })),
    reads: report.reads.map((r) => ({
      file: r.file,
      line: r.line,
      kind: r.kind,
      snippet: r.snippet,
    })),
  })),
});

export const deadStoresCommand = new Command("dead-stores")
  .description("Detect writable stores that are never written to (runes migration helper)")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action((directory: string, flags: { json?: boolean }) => {
    try {
      const resolvedDirectory = path.resolve(directory);
      validateDirectory(resolvedDirectory);

      const result = analyzeDeadStores(resolvedDirectory);

      if (flags.json) {
        logger.log(JSON.stringify(buildJsonPayload(result), null, 2));
        return;
      }

      if (result.totalStores === 0) {
        logger.dim("  No stores found in this project.");
        logger.break();
        return;
      }

      const dead = result.stores.filter((s) => s.status === "never-written");
      const ok = result.stores.filter((s) => s.status === "ok");

      logger.log(highlighter.bold(`  Dead store report: ${result.deadStores} never-written, ${ok.length} ok, ${result.totalStores} total`));
      logger.break();

      if (dead.length > 0) {
        logger.log(highlighter.warn(`  Never written (candidates for readable or $state):`));
        logger.break();
        for (const report of dead) {
          const decl = report.declaration;
          logger.log(`  ${highlighter.bold(decl.name)} - ${decl.kind} - ${highlighter.warn("NEVER WRITTEN")} (${decl.file}:${decl.line})`);
          const readsOut = formatReads(report.reads);
          if (readsOut) {
            logger.log(readsOut);
          }
          logger.log(`  Replace with: ${sanitize(report.suggestion)}`);
          logger.break();
        }
      }

      if (ok.length > 0) {
        logger.log(highlighter.success(`  Written (OK):`));
        logger.break();
        for (const report of ok) {
          const decl = report.declaration;
          logger.log(`  ${highlighter.bold(decl.name)} - ${decl.kind} - ${highlighter.success("WRITTEN")} (${decl.file}:${decl.line})`);
          const writesOut = formatWrites(report.writes);
          if (writesOut) {
            logger.log(writesOut);
          }
          logger.break();
        }
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
