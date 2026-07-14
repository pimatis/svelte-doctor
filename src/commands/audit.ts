import { Command } from "commander";
import { runAudit } from "../core/audit.js";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { VERSION } from "../constants.js";

export const auditCommand = new Command("audit")
  .description("Security-focused scan — checks only security rules")
  .argument("[directory]", "project directory", ".")
  .option("--json", "output machine-readable JSON")
  .option("--score", "output only the security score")
  .action(async (directory: string, flags: { json?: boolean; score?: boolean }) => {
    try {
      const result = await runAudit(directory);
      if (flags.json) {
        logger.log(JSON.stringify(result, null, 2));
        return;
      }
      if (flags.score) {
        logger.log(String(result.securityScore.score));
        return;
      }
      logger.break();
      logger.log(`  ${highlighter.bold("svelte-doctor audit")} v${VERSION}`);
      logger.break();
      const scoreColor =
        result.securityScore.score >= 75
          ? highlighter.success
          : result.securityScore.score >= 50
            ? highlighter.warn
            : highlighter.error;
      logger.log(
        `  Security Score: ${scoreColor(String(result.securityScore.score))} / 100  ${result.securityScore.label}`,
      );
      logger.log(
        `  Issues: ${highlighter.error(String(result.errorCount))} errors  ${highlighter.warn(String(result.warningCount))} warnings  Files: ${result.totalFiles}`,
      );
      logger.break();
      if (result.securityDiagnostics.length > 0) {
        for (const d of result.securityDiagnostics) {
          const icon = d.severity === "error" ? highlighter.error("●") : highlighter.warn("●");
          logger.log(`  ${icon} ${sanitize(d.filePath)}:${d.line}  ${sanitize(d.message)}`);
          logger.dim(`    rule: ${sanitize(d.rule)}  ${sanitize(d.help)}`);
        }
        logger.break();
      } else {
        logger.success("  ✓ No security issues found.");
        logger.break();
      }
    } catch (error) {
      if (error instanceof Error) logger.error(`  Error: ${error.message}`);
      process.exit(1);
    }
  });
