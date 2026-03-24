import type { Rule, Diagnostic, RuleContext } from "../../types.js";

// builds a line-index → boolean map in a single O(n) pass
// true means the line is inside a <script> block (instance or module)
const buildScriptLineMap = (source: string): boolean[] => {
  const lines = source.split("\n");
  const map: boolean[] = new Array(lines.length).fill(false);
  let inside = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^<script[\s>]/.test(trimmed)) { inside = true; continue; }
    if (trimmed === "</script>") { inside = false; continue; }
    map[i] = inside;
  }

  return map;
};

// shared helper — constructs a fresh RegExp per call to avoid shared lastIndex state
const scanLines = (
  ctx: RuleContext,
  rule: Pick<Rule, "name" | "severity" | "message" | "help" | "category">,
  patternSource: string,
  patternFlags = "",
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const lines = ctx.source.split("\n");
  const pattern = new RegExp(patternSource, patternFlags);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

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
  message: "Usage of `{@html}` detected — this is an XSS risk",
  help: "Avoid `{@html}` with untrusted data. Sanitize content with a library like `dompurify` before rendering, or restructure to avoid raw HTML injection entirely.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx) => {
    // {@html} is a template directive — it only exists in .svelte template sections
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    const pattern = /\{@html\s/;

    for (let i = 0; i < lines.length; i++) {
      // {@html} cannot appear inside a <script> block — skip to avoid false positives
      // on strings like `const html = '{@html foo}'` in test or documentation
      if (scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noUnsafeHtml.name,
        severity: noUnsafeHtml.severity,
        message: noUnsafeHtml.message,
        help: noUnsafeHtml.help,
        line: i + 1,
        column: match.index + 1,
        category: noUnsafeHtml.category,
      });
    }

    return diagnostics;
  },
};

// each pattern is tested independently so one line can only produce one diagnostic
const secretPatterns: Array<{ pattern: RegExp; label: string }> = [
  {
    // api_key or apikey assignments with values 16+ chars
    pattern: /(?:api_key|apikey)\s*[:=]\s*['"`][\w\-/.]{16,}['"`]/i,
    label: "API key",
  },
  {
    // generic secret/token/password assignments with values 8+ chars
    pattern: /(?:secret|token|password)\s*[:=]\s*['"`][\w\-/.]{8,}['"`]/i,
    label: "secret/token/password",
  },
  {
    // Stripe live/test secret keys
    pattern: /sk-(?:live|test)_[A-Za-z0-9]{10,}/,
    label: "Stripe secret key",
  },
  {
    // GitHub personal access tokens (classic and fine-grained)
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/,
    label: "GitHub token",
  },
  {
    // JWT tokens embedded as string literals
    pattern: /['"`]eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+['"`]/,
    label: "JWT token",
  },
  {
    // AWS access key IDs
    pattern: /AKIA[0-9A-Z]{16}/,
    label: "AWS access key",
  },
];

const noSecrets: Rule = {
  name: "no-secrets",
  category: "Security",
  severity: "error",
  message: "Possible hardcoded secret or API key detected",
  help: "Move secrets to environment variables and access them through `$env/static/private` or a server-side `.env` file. Never commit secrets to source control.",
  appliesTo: ["all"],
  cost: "low",
  check: (ctx) => {
    // .env files are expected to contain secrets — they are gitignored, not source files
    if (/(?:^|[\\/])\.env(?:\.\w+)?$/.test(ctx.filePath)) return [];

    // test and fixture files often use intentionally fake secrets for testing
    if (/\.(test|spec)\.(ts|js|svelte)$/.test(ctx.filePath)) return [];
    if (/(?:^|[\\/])(?:fixtures?|__mocks?__|__tests?__)[\\/]/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();

      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      for (const { pattern } of secretPatterns) {
        // construct a fresh RegExp to avoid shared lastIndex across files
        const freshPattern = new RegExp(pattern.source, pattern.flags);
        const match = freshPattern.exec(line);
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

        // one diagnostic per line is enough — avoid duplicate noise from multiple patterns
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
  message: "Usage of `eval()` detected — allows arbitrary code execution",
  help: "Remove `eval()` and use safer alternatives like `JSON.parse()` for data, or structured alternatives for dynamic logic. `eval` is a common code injection vector.",
  appliesTo: ["all"],
  cost: "low",
  check: (ctx) => {
    // skip test files where eval may legitimately be tested or asserted against
    if (/\.(test|spec)\.(ts|js|svelte)$/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // \beval\s*( — word boundary prevents matching "evaluate(", "medieval(", etc.
    // also skip lines that call node:vm methods like vm.runInContext which are
    // intentional sandboxed evaluation patterns
    const pattern = /\beval\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      // node:vm and similar sandboxed eval patterns are intentional — skip them
      if (/\bvm\s*\.\s*(?:runInContext|runInNewContext|runInThisContext|Script)\b/.test(lines[i])) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      // skip when the match falls inside a string literal — this prevents false
      // positives from regex source strings, JSDoc examples, and documentation
      // that contain the text eval( as a string value rather than a real call
      const beforeMatch = lines[i].slice(0, match.index);
      const singleQuotes = (beforeMatch.match(/'/g) ?? []).length;
      const doubleQuotes = (beforeMatch.match(/"/g) ?? []).length;
      const backticks = (beforeMatch.match(/`/g) ?? []).length;
      const insideString =
        singleQuotes % 2 !== 0 ||
        doubleQuotes % 2 !== 0 ||
        backticks % 2 !== 0;
      if (insideString) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noEval.name,
        severity: noEval.severity,
        message: noEval.message,
        help: noEval.help,
        line: i + 1,
        column: match.index + 1,
        category: noEval.category,
      });
    }

    return diagnostics;
  },
};

// sensitive env var name segments that should never be exposed via public $env modules
const publicEnvModulePattern = /from\s+['"](?:\$env\/static\/public|\$env\/dynamic\/public)['"]/;
const sensitiveVarPattern = /(?:SECRET|TOKEN|KEY|PASSWORD|AUTH|CREDENTIAL|PRIVATE)/i;

const noPublicEnvSecrets: Rule = {
  name: "no-public-env-secrets",
  category: "Security",
  severity: "error",
  message: "Sensitive environment variable imported from a public `$env` module",
  help: "Use `$env/static/private` or `$env/dynamic/private` for secrets. Public env vars are bundled into the client and visible to anyone who inspects the page.",
  appliesTo: ["all"],
  cost: "low",
  check: (ctx) => {
    if (ctx.projectInfo.framework !== "sveltekit") return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // the from-clause must reference a public $env module
      if (!publicEnvModulePattern.test(line)) continue;

      // collect the full import statement — it may span multiple lines:
      //   import {
      //     SECRET_KEY
      //   } from '$env/static/public'
      // walk backwards from the from-clause line to find "import {"
      let importStart = i;
      for (let j = i; j >= Math.max(0, i - 10); j--) {
        if (/\bimport\s*\{/.test(lines[j])) {
          importStart = j;
          break;
        }
      }

      const importBlock = lines.slice(importStart, i + 1).join(" ");

      if (!sensitiveVarPattern.test(importBlock)) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noPublicEnvSecrets.name,
        severity: noPublicEnvSecrets.severity,
        message: noPublicEnvSecrets.message,
        help: noPublicEnvSecrets.help,
        line: importStart + 1,
        column: 1,
        category: noPublicEnvSecrets.category,
      });
    }

    return diagnostics;
  },
};

const noDangerousRedirectParam: Rule = {
  name: "no-dangerous-redirect-param",
  category: "Security",
  severity: "error",
  message: "Potential open redirect from untrusted redirect parameter",
  help: "Validate redirect targets against an allowlist or force internal relative paths before calling redirect/goto/location.href.",
  appliesTo: ["all"],
  cost: "low",
  check: (ctx) => {
    if (/\.(test|spec)\.(ts|js|svelte)$/.test(ctx.filePath)) return [];
    if (/(?:^|[\\/])tests?[\\/]/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      if (!/(redirect|goto|location\.href|location\.assign)/.test(line)) continue;
      if (!/(searchParams\.get\(['"`]redirect['"`]\)|url\.searchParams\.get\(['"`]redirect['"`]\)|params\.redirect|query\.redirect)/.test(line)) {
        continue;
      }

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noDangerousRedirectParam.name,
        severity: noDangerousRedirectParam.severity,
        message: noDangerousRedirectParam.message,
        help: noDangerousRedirectParam.help,
        line: i + 1,
        column: Math.max(1, line.search(/redirect|goto|location\.href|location\.assign/) + 1),
        category: noDangerousRedirectParam.category,
      });
    }

    return diagnostics;
  },
};

const cookieMissingSecureFlags: Rule = {
  name: "cookie-missing-secure-flags",
  category: "Security",
  severity: "error",
  message: "cookies.set() call is missing secure cookie flags",
  help: "Set `httpOnly`, `secure`, and `sameSite` explicitly on cookies written from SvelteKit server code.",
  appliesTo: ["script"],
  cost: "low",
  check: (ctx) => {
    if (ctx.projectInfo.framework !== "sveltekit") return [];
    if (!/\.(server|hooks)\.(ts|js)$/.test(ctx.filePath) && !/\+page\.server\.(ts|js)$/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      if (!/cookies\.set\s*\(/.test(line)) continue;
      const window = ctx.lines.slice(i, Math.min(ctx.lines.length, i + 6)).join(" ");
      if (/\bhttpOnly\s*:/.test(window) && /\bsecure\s*:/.test(window) && /\bsameSite\s*:/.test(window)) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: cookieMissingSecureFlags.name,
        severity: cookieMissingSecureFlags.severity,
        message: cookieMissingSecureFlags.message,
        help: cookieMissingSecureFlags.help,
        line: i + 1,
        column: line.indexOf("cookies.set") + 1,
        category: cookieMissingSecureFlags.category,
      });
    }

    return diagnostics;
  },
};

const noBroadCors: Rule = {
  name: "no-broad-cors",
  category: "Security",
  severity: "error",
  message: "Overly broad CORS configuration detected",
  help: "Avoid `Access-Control-Allow-Origin: *` on authenticated endpoints and never combine wildcard origins with credentials.",
  appliesTo: ["script"],
  cost: "low",
  check: (ctx) => {
    if (/\.(test|spec)\.(ts|js|svelte)$/.test(ctx.filePath)) return [];
    if (/(?:^|[\\/])tests?[\\/]/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      const lineHasWildcardOrigin =
        /Access-Control-Allow-Origin['"`]?\s*[:,]\s*['"`]\*['"`]/.test(line) ||
        /setHeaders?\([^)]*Access-Control-Allow-Origin[^)]*['"`]\*['"`]/.test(line) ||
        /headers\.set\(\s*['"`]Access-Control-Allow-Origin['"`]\s*,\s*['"`]\*['"`]\s*\)/.test(line);
      if (!lineHasWildcardOrigin) continue;

      const nearby = ctx.lines.slice(Math.max(0, i - 2), Math.min(ctx.lines.length, i + 4)).join(" ");
      const withCredentials = /Access-Control-Allow-Credentials['"`]?\s*[:,]\s*(?:true|['"`]true['"`])/.test(nearby) ||
        /headers\.set\(\s*['"`]Access-Control-Allow-Credentials['"`]\s*,\s*['"`]true['"`]\s*\)/.test(nearby);

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noBroadCors.name,
        severity: noBroadCors.severity,
        message: withCredentials
          ? "Wildcard CORS origin combined with credentials is unsafe"
          : noBroadCors.message,
        help: noBroadCors.help,
        line: i + 1,
        column: 1,
        category: noBroadCors.category,
      });
    }

    return diagnostics;
  },
};

const noServerSecretLeak: Rule = {
  name: "no-server-secret-leak",
  category: "Security",
  severity: "error",
  message: "Private env value appears to be returned to the client",
  help: "Do not include private env vars in load() return values, JSON responses, or serialized payloads.",
  appliesTo: ["script"],
  cost: "medium",
  check: (ctx) => {
    if (ctx.projectInfo.framework !== "sveltekit") return [];
    if (!/\.(server|hooks)\.(ts|js)$/.test(ctx.filePath) && !/\+page\.server\.(ts|js)$/.test(ctx.filePath)) return [];

    const privateEnvNames = new Set<string>();
    for (const line of ctx.lines) {
      const match = line.match(/import\s+\{([^}]+)\}\s+from\s+['"]\$env\/(?:static|dynamic)\/private['"]/);
      if (!match) continue;
      for (const entry of match[1].split(",")) {
        const normalized = entry.trim().split(/\s+as\s+/i).pop();
        if (normalized) privateEnvNames.add(normalized.trim());
      }
    }

    if (privateEnvNames.size === 0) return [];

    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      if (!/\b(return|json)\b/.test(line)) continue;

      for (const envName of privateEnvNames) {
        if (!new RegExp(`\\b${envName}\\b`).test(line)) continue;
        diagnostics.push({
          filePath: ctx.filePath,
          rule: noServerSecretLeak.name,
          severity: noServerSecretLeak.severity,
          message: noServerSecretLeak.message,
          help: noServerSecretLeak.help,
          line: i + 1,
          column: Math.max(1, line.indexOf(envName) + 1),
          category: noServerSecretLeak.category,
        });
      }
    }

    return diagnostics;
  },
};

const noUnsafeShell: Rule = {
  name: "no-unsafe-shell",
  category: "Security",
  severity: "error",
  message: "Unsafe shell execution pattern detected",
  help: "Prefer direct argv-based process spawning. Avoid `exec`, `execSync`, or `spawn(..., { shell: true })` with untrusted input.",
  appliesTo: ["script"],
  cost: "low",
  check: (ctx) => {
    if (/\.(test|spec)\.(ts|js|svelte)$/.test(ctx.filePath)) return [];
    if (/(?:^|[\\/])tests?[\\/]/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];

    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      const trimmed = line.trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (trimmed.startsWith("message:") || trimmed.startsWith("help:")) continue;
      if (/(?:const|let|var)\s+\w+\s*=\s*\/.*(?:exec|spawn|shell).*\/[dgimsuy]*/.test(line)) continue;
      if (/:\s*\/.*(?:exec|spawn|shell).*\/[dgimsuy]*/.test(line)) continue;
      const match = /(?<!\.)\b(exec|execSync)\s*\(|(?<!\.)\bspawn\s*\([^)]*\{[^}]*shell\s*:\s*true/.exec(line);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noUnsafeShell.name,
        severity: noUnsafeShell.severity,
        message: noUnsafeShell.message,
        help: noUnsafeShell.help,
        line: i + 1,
        column: match.index + 1,
        category: noUnsafeShell.category,
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
  noDangerousRedirectParam,
  cookieMissingSecureFlags,
  noBroadCors,
  noServerSecretLeak,
  noUnsafeShell,
];
