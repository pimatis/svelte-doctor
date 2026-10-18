import path from "node:path";
import { Command } from "commander";
import { analyzeTaint, describeStateWriters } from "../core/taint.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { validateDirectory } from "../fs/validate.js";

export const taintCommand = new Command("taint")
  .description("Track exported and module-level $state writes across files")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .action((directory: string, flags: { json?: boolean }) => {
    try {
      const resolvedDirectory = path.resolve(directory);
      validateDirectory(resolvedDirectory);

      const result = analyzeTaint(resolvedDirectory);

      if (flags.json) {
        logger.json(
          JSON.stringify(
            {
              totalStates: result.totalStates,
              moduleStates: result.moduleStates,
              findings: result.findings.map((finding) => ({
                kind: finding.kind,
                name: finding.declaration.name,
                file: finding.declaration.file,
                line: finding.declaration.line,
                scope: finding.declaration.scope,
                exported: finding.declaration.exported,
                writes: finding.writes.map((write) => ({
                  file: write.file,
                  line: write.line,
                  accessor: write.accessor,
                  kind: write.kind,
                })),
              })),
            },
            null,
            2,
          ),
        );
        return;
      }

      if (result.totalStates === 0) {
        logger.dim("  No `$state` declarations found in this project.");
        logger.break();
        return;
      }

      logger.log(
        highlighter.bold(
          `  Runes taint report: ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"}, ${result.totalStates} state declaration${result.totalStates === 1 ? "" : "s"} (${result.moduleStates} module-scope)`,
        ),
      );
      logger.break();

      if (result.findings.length === 0) {
        logger.success("  ✓ No exported or shared mutable state across files.");
        logger.break();
        return;
      }

      for (const finding of result.findings) {
        const label =
          finding.kind === "cross-file-write"
            ? highlighter.warn("EXPORTED, WRITTEN ELSEWHERE")
            : highlighter.warn("MODULE-SCOPE SINGLETON");
        logger.log(
          `  ${highlighter.bold(finding.declaration.name)} - ${label} (${finding.declaration.file}:${finding.declaration.line})`,
        );
        logger.log(`  Writers: ${sanitize(describeStateWriters(finding.writes))}`);
        logger.break();
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
