import type { Rule, Diagnostic, RuleContext } from "../../types.js";
import { getLineAndColumn, isIdentifierNamed, ts, walkSourceFile } from "../../parser/script.js";

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

const pushScriptDiagnostic = (
  diagnostics: Diagnostic[],
  ctx: RuleContext,
  rule: Rule,
  block: RuleContext["scriptBlocks"][number],
  position: number,
  message = rule.message,
) => {
  const { line, column } = getLineAndColumn(block, position);
  diagnostics.push({
    filePath: ctx.filePath,
    rule: rule.name,
    severity: rule.severity,
    message,
    help: rule.help,
    line,
    column,
    category: rule.category,
  });
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
  docs: {
    summary: "Flags direct runtime evaluation via eval().",
    whyItMatters: "eval() turns data into executable code and dramatically increases RCE risk.",
    safeFix: "Replace eval() with structured parsing or explicit dispatch.",
  },
  check: (ctx) => {
    if (/\.(test|spec)\.(ts|js|svelte)$/.test(ctx.filePath)) return [];
    if (/(?:^|[\\/])tests?[\\/]/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];

    for (const block of ctx.scriptBlocks) {
      walkSourceFile(block.sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;
        if (!isIdentifierNamed(node.expression, "eval")) return;
        pushScriptDiagnostic(diagnostics, ctx, noEval, block, node.expression.getStart(block.sourceFile));
      });
    }

    return diagnostics;
  },
};

// sensitive env var name segments that should never be exposed via public $env modules
const isSensitiveEnvName = (name: string): boolean =>
  /(?:^|_)(?:SECRET|TOKEN|KEY|PASSWORD|AUTH|CREDENTIAL|PRIVATE)(?:_|$)/i.test(name);

const escapeRegexLiteral = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasSensitiveEnvObjectAccess = (source: string, objectName: string): boolean => {
  const escapedObject = escapeRegexLiteral(objectName);
  const dotAccess = new RegExp(`\\b${escapedObject}\\.([A-Za-z_$][\\w$]*)`, "g");
  let dotMatch: RegExpExecArray | null;
  while ((dotMatch = dotAccess.exec(source)) !== null) {
    if (isSensitiveEnvName(dotMatch[1])) return true;
  }

  const bracketAccess = new RegExp("\\b" + escapedObject + "\\[\\s*['\"`]([^'\"`]+)['\"`]\\s*\\]", "g");
  let bracketMatch: RegExpExecArray | null;
  while ((bracketMatch = bracketAccess.exec(source)) !== null) {
    if (isSensitiveEnvName(bracketMatch[1])) return true;
  }

  return false;
};

const noPublicEnvSecrets: Rule = {
  name: "no-public-env-secrets",
  category: "Security",
  severity: "error",
  message: "Sensitive environment variable imported from a public `$env` module",
  help: "Use `$env/static/private` or `$env/dynamic/private` for secrets. Public env vars are bundled into the client and visible to anyone who inspects the page.",
  appliesTo: ["all"],
  cost: "low",
  docs: {
    summary: "Blocks sensitive vars imported from public SvelteKit env modules.",
    whyItMatters: "Public env imports are bundled client-side and expose secrets immediately.",
    safeFix: "Move secrets to $env/static/private or $env/dynamic/private.",
  },
  check: (ctx) => {
    if (ctx.projectInfo.framework !== "sveltekit") return [];

    const diagnostics: Diagnostic[] = [];

    for (const block of ctx.scriptBlocks) {
      const publicEnvObjects = new Set<string>();

      walkSourceFile(block.sourceFile, (node) => {
        if (!ts.isImportDeclaration(node)) return;
        if (!ts.isStringLiteral(node.moduleSpecifier)) return;

        const moduleName = node.moduleSpecifier.text;
        if (!/^\$env\/(?:static|dynamic)\/public$/.test(moduleName)) return;
        if (!node.importClause?.namedBindings) return;

        if (ts.isNamespaceImport(node.importClause.namedBindings)) {
          publicEnvObjects.add(node.importClause.namedBindings.name.text);
          return;
        }

        if (!ts.isNamedImports(node.importClause.namedBindings)) return;

        for (const element of node.importClause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === "env") {
            publicEnvObjects.add(element.name.text);
          }
        }

        const hasSensitiveImport = node.importClause.namedBindings.elements.some((element) => {
          const imported = element.propertyName?.text ?? element.name.text;
          return isSensitiveEnvName(imported);
        });
        if (!hasSensitiveImport) return;

        pushScriptDiagnostic(diagnostics, ctx, noPublicEnvSecrets, block, node.getStart(block.sourceFile));
      });

      if (publicEnvObjects.size === 0) continue;

      walkSourceFile(block.sourceFile, (node) => {
        if (!ts.isPropertyAccessExpression(node)) return;
        if (!ts.isIdentifier(node.expression)) return;
        if (!publicEnvObjects.has(node.expression.text)) return;
        if (!isSensitiveEnvName(node.name.text)) return;

        pushScriptDiagnostic(diagnostics, ctx, noPublicEnvSecrets, block, node.name.getStart(block.sourceFile));
      });

      walkSourceFile(block.sourceFile, (node) => {
        if (!ts.isElementAccessExpression(node)) return;
        if (!ts.isIdentifier(node.expression)) return;
        if (!publicEnvObjects.has(node.expression.text)) return;
        if (!ts.isStringLiteralLike(node.argumentExpression)) return;
        if (!isSensitiveEnvName(node.argumentExpression.text)) return;

        pushScriptDiagnostic(diagnostics, ctx, noPublicEnvSecrets, block, node.argumentExpression.getStart(block.sourceFile));
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
    if (!/\.(server|hooks)\.(ts|js)$/.test(ctx.filePath) && !/\+(page\.server|server)\.(ts|js)$/.test(ctx.filePath)) return [];

    const privateEnvNames = new Set<string>();
    const privateEnvObjects = new Set<string>();
    for (const block of ctx.scriptBlocks) {
      walkSourceFile(block.sourceFile, (node) => {
        if (!ts.isImportDeclaration(node)) return;
        if (!ts.isStringLiteral(node.moduleSpecifier)) return;
        if (!/^\$env\/(?:static|dynamic)\/private$/.test(node.moduleSpecifier.text)) return;
        if (!node.importClause?.namedBindings) return;

        if (ts.isNamespaceImport(node.importClause.namedBindings)) {
          privateEnvObjects.add(node.importClause.namedBindings.name.text);
          return;
        }

        if (!ts.isNamedImports(node.importClause.namedBindings)) return;
        for (const element of node.importClause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (imported === "env") {
            privateEnvObjects.add(element.name.text);
            continue;
          }
          privateEnvNames.add(element.name.text);
        }
      });
    }

    if (privateEnvNames.size === 0 && privateEnvObjects.size === 0) return [];

    const diagnostics: Diagnostic[] = [];
    for (let i = 0; i < ctx.lines.length; i++) {
      const line = ctx.lines[i];
      if (!/\b(return|json)\b/.test(line)) continue;

      const nearby = ctx.lines.slice(i, Math.min(ctx.lines.length, i + 8)).join("\n");

      for (const envName of privateEnvNames) {
        if (!new RegExp(`\\b${escapeRegexLiteral(envName)}\\b`).test(nearby)) continue;
        diagnostics.push({
          filePath: ctx.filePath,
          rule: noServerSecretLeak.name,
          severity: noServerSecretLeak.severity,
          message: noServerSecretLeak.message,
          help: noServerSecretLeak.help,
          line: i + 1,
          column: Math.max(1, line.search(/\b(return|json)\b/) + 1),
          category: noServerSecretLeak.category,
        });
      }

      for (const envObject of privateEnvObjects) {
        if (!hasSensitiveEnvObjectAccess(nearby, envObject)) continue;
        diagnostics.push({
          filePath: ctx.filePath,
          rule: noServerSecretLeak.name,
          severity: noServerSecretLeak.severity,
          message: noServerSecretLeak.message,
          help: noServerSecretLeak.help,
          line: i + 1,
          column: Math.max(1, line.search(/\b(return|json)\b/) + 1),
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
  docs: {
    summary: "Flags direct shell execution or child_process spawn with shell:true.",
    whyItMatters: "String-based shell execution expands attacker-controlled input into full command injection.",
    safeFix: "Use argv-based execFile/spawn without shell:true and validate command sources.",
  },
  check: (ctx) => {
    if (/\.(test|spec)\.(ts|js|svelte)$/.test(ctx.filePath)) return [];
    if (/(?:^|[\\/])tests?[\\/]/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];

    for (const block of ctx.scriptBlocks) {
      walkSourceFile(block.sourceFile, (node) => {
        if (!ts.isCallExpression(node)) return;

        if (isIdentifierNamed(node.expression, "exec") || isIdentifierNamed(node.expression, "execSync")) {
          pushScriptDiagnostic(diagnostics, ctx, noUnsafeShell, block, node.expression.getStart(block.sourceFile));
          return;
        }

        if (!isIdentifierNamed(node.expression, "spawn")) return;
        if (node.arguments.length < 2) return;

        const optionsArg = node.arguments.find((argument) => ts.isObjectLiteralExpression(argument));
        if (!optionsArg || !ts.isObjectLiteralExpression(optionsArg)) return;

        const hasShellTrue = optionsArg.properties.some((property) => {
          if (!ts.isPropertyAssignment(property)) return false;
          const key = ts.isIdentifier(property.name) ? property.name.text : ts.isStringLiteral(property.name) ? property.name.text : "";
          return key === "shell" && property.initializer.kind === ts.SyntaxKind.TrueKeyword;
        });

        if (!hasShellTrue) return;
        pushScriptDiagnostic(diagnostics, ctx, noUnsafeShell, block, node.expression.getStart(block.sourceFile));
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
