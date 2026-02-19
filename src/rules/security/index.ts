import type { Rule, Diagnostic, RuleContext } from "../../types.js";

// Shared helper that scans source lines against a regex and collects diagnostics.
const scanLines = (
  ctx: RuleContext,
  rule: Pick<Rule, "name" | "severity" | "message" | "help" | "category">,
  pattern: RegExp,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const lines = ctx.source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = pattern.exec(lines[i]);
    if (!match) continue;

    diagnostics.push({
      filePath: ctx.filePath,
      rule: rule.name,
      severity: rule.severity,
      message: rule.message,
      help: rule.help,
      line: i + 1,
      column: match.index + 1,
      category: rule.category,
    });
  }

  return diagnostics;
};

const noUnsafeHtml: Rule = {
  name: "no-unsafe-html",
  category: "Security",
  severity: "error",
  message: "Usage of `{@html}` detected which is an XSS risk",
  help: "Avoid `{@html}` with untrusted data. Sanitize content with a library like `dompurify` before rendering",
  check: (ctx) => {
    // catches {@html ...} expressions in svelte templates
    return scanLines(ctx, noUnsafeHtml, /\{@html\s/);
  },
};

// Patterns that indicate hardcoded secrets with each tested independently per line.
const secretPatterns: RegExp[] = [
  // api_key or apikey assignments with values 16+ chars long
  /(?:api_key|apikey)\s*[:=]\s*['"`][\w\-/.]{16,}['"`]/i,
  // secret, token, or password assignments with values 8+ chars long
  /(?:secret|token|password)\s*[:=]\s*['"`][\w\-/.]{8,}['"`]/i,
  // stripe live/test secret keys
  /sk-(?:live|test)_[A-Za-z0-9]{10,}/,
  // github personal access tokens and variants
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  // JWT tokens embedded as string literals
  /['"`]eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+['"`]/,
];

const noSecrets: Rule = {
  name: "no-secrets",
  category: "Security",
  severity: "error",
  message: "Possible hardcoded secret or API key detected",
  help: "Move secrets to environment variables and access them through `$env/static/private` or a `.env` file",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();

      // skip comment lines to reduce false positives
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      for (const pattern of secretPatterns) {
        const match = pattern.exec(line);
        if (!match) continue;

        diagnostics.push({
          filePath: ctx.filePath,
          rule: noSecrets.name,
          severity: noSecrets.severity,
          message: noSecrets.message,
          help: noSecrets.help,
          line: i + 1,
          column: match.index + 1,
          category: noSecrets.category,
        });

        // One diagnostic per line is enough to avoid duplicate noise.
        break;
      }
    }

    return diagnostics;
  },
};

const noEval: Rule = {
  name: "no-eval",
  category: "Security",
  severity: "error",
  message: "Usage of `eval()` detected which allows arbitrary code execution",
  help: "Remove `eval()` and use safer alternatives like `JSON.parse()`, `new Function()`, or structured data handling",
  check: (ctx) => {
    // matches eval( calls, avoids matching method names like "evaluate" or property access
    return scanLines(ctx, noEval, /\beval\s*\(/);
  },
};

// sensitive env var name segments that should never be exposed publicly
const sensitiveEnvPattern = /from\s+['"](?:\$env\/static\/public|\$env\/dynamic\/public)['"]/;
const sensitiveVarPattern = /(?:SECRET|TOKEN|KEY|PASSWORD|AUTH|CREDENTIAL)/i;

const noPublicEnvSecrets: Rule = {
  name: "no-public-env-secrets",
  category: "Security",
  severity: "error",
  message: "Sensitive environment variable imported from a public `$env` module",
  help: "Use `$env/static/private` or `$env/dynamic/private` for secrets since public env vars are exposed to the client",
  check: (ctx) => {
    // only relevant in sveltekit projects
    if (ctx.projectInfo.framework !== "sveltekit") return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!sensitiveEnvPattern.test(line)) continue;
      if (!sensitiveVarPattern.test(line)) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noPublicEnvSecrets.name,
        severity: noPublicEnvSecrets.severity,
        message: noPublicEnvSecrets.message,
        help: noPublicEnvSecrets.help,
        line: i + 1,
        column: 1,
        category: noPublicEnvSecrets.category,
      });
    }

    return diagnostics;
  },
};

export const securityRules: Rule[] = [
  noUnsafeHtml,
  noSecrets,
  noEval,
  noPublicEnvSecrets,
];
