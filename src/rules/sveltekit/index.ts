import fs from "node:fs";
import path from "node:path";
import type { Rule, Diagnostic, RuleContext } from "../../types.js";
import { getLineAndColumn, ts, walkSourceFile } from "../../parser/script.js";

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

// flags fetch() calls inside .svelte component scripts
// data fetching belongs in load() functions or form actions, not component scripts
const noClientFetch: Rule = {
  name: "no-client-fetch",
  category: "SvelteKit",
  severity: "warning",
  message: "Avoid `fetch()` in component scripts — use SvelteKit `load` functions or form actions instead.",
  help: "Move data fetching to `+page.ts` / `+page.server.ts` load functions, or use form actions for mutations.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (ctx.projectInfo.framework !== "sveltekit") return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    // server files already have fetch in the right place
    if (/\+(page|layout)\.server/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    const fetchPattern = /\bfetch\s*\(/;

    // track function nesting depth so we can skip fetch() calls that live
    // inside named form-action handlers or submit/enhance callbacks
    let functionDepth = 0;
    let insideEventHandler = false;
    let eventHandlerDepth = 0;
    let prevWasScript = false;

    for (let i = 0; i < lines.length; i++) {
      if (!scriptMap[i]) {
        // reset state when leaving a script region
        if (prevWasScript) {
          functionDepth = 0;
          insideEventHandler = false;
          eventHandlerDepth = 0;
        }
        prevWasScript = false;
        continue;
      }
      prevWasScript = true;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const line = lines[i];

      // track brace depth first to know handler scope boundaries
      for (const ch of line) {
        if (ch === "{") functionDepth++;
        if (ch === "}") {
          functionDepth--;
          if (insideEventHandler && functionDepth <= eventHandlerDepth) {
            insideEventHandler = false;
          }
        }
      }

      // detect entry into a named event / form / submit handler
      // these are legitimate places to call fetch() directly
      if (/\b(?:actions|handleSubmit|onSubmit|enhance)\b.*\{/.test(line) ||
          /\bfunction\s+handle(?:Submit|Form|Action)\b/.test(line)) {
        insideEventHandler = true;
        eventHandlerDepth = functionDepth;
      }

      if (insideEventHandler) continue;
      if (!fetchPattern.test(line)) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-client-fetch",
        severity: "warning",
        message: noClientFetch.message,
        help: noClientFetch.help,
        line: i + 1,
        column: line.indexOf("fetch") + 1,
        category: "SvelteKit",
      });
    }

    return diagnostics;
  },
};

// ensures load functions have explicit type annotations for type safety
// only meaningful in TypeScript projects since JS has no annotation syntax
const loadMissingType: Rule = {
  name: "load-missing-type",
  category: "SvelteKit",
  severity: "warning",
  message: "Load function is missing a type annotation or `satisfies` clause",
  help: "Add a type annotation like `export const load: PageLoad = ...` or use `satisfies PageLoad` for full type inference.",
  appliesTo: ["script"],
  cost: "low",
  docs: {
    summary: "Requires explicit typing for exported load handlers.",
    whyItMatters: "Typed load functions catch server/client contract drift before runtime.",
    safeFix: "Add a direct annotation or wrap the initializer with satisfies PageLoad/LayoutLoad.",
  },
  check: (ctx: RuleContext): Diagnostic[] => {
    // only applies to SvelteKit route files
    if (!/\+(page|layout)\.(ts|server\.ts|js|server\.js)$/.test(ctx.filePath)) return [];

    // type annotations only exist in TypeScript — skip JS projects entirely
    if (!ctx.projectInfo.hasTypeScript) return [];

    // pure .js files cannot carry type annotations
    if (ctx.filePath.endsWith(".js")) return [];

    const diagnostics: Diagnostic[] = [];

    for (const block of ctx.scriptBlocks) {
      walkSourceFile(block.sourceFile, (node) => {
        if (ts.isVariableStatement(node)) {
          const isExported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
          if (!isExported) return;

          for (const declaration of node.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "load") continue;
            if (declaration.type) continue;
            if (declaration.initializer && declaration.initializer.kind === ts.SyntaxKind.SatisfiesExpression) continue;

            const { line, column } = getLineAndColumn(block, declaration.name.getStart(block.sourceFile));
            diagnostics.push({
              filePath: ctx.filePath,
              rule: loadMissingType.name,
              severity: loadMissingType.severity,
              message: loadMissingType.message,
              help: loadMissingType.help,
              line,
              column,
              category: loadMissingType.category,
            });
          }
          return;
        }

        if (!ts.isFunctionDeclaration(node)) return;
        if (!node.name || node.name.text !== "load") return;
        const isExported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
        if (!isExported || node.type) return;

        const { line, column } = getLineAndColumn(block, node.name.getStart(block.sourceFile));
        diagnostics.push({
          filePath: ctx.filePath,
          rule: loadMissingType.name,
          severity: loadMissingType.severity,
          message: loadMissingType.message,
          help: loadMissingType.help,
          line,
          column,
          category: loadMissingType.category,
        });
      });
    }

    return diagnostics;
  },
};

// prevents using goto() with external URLs — use window.location or <a> tags instead
const noGotoExternal: Rule = {
  name: "no-goto-external",
  category: "SvelteKit",
  severity: "warning",
  message: "`goto()` should not be used with external URLs",
  help: "SvelteKit's `goto()` is designed for internal navigation. Use `window.location.href` or an `<a>` tag for external redirects.",
  appliesTo: ["all"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (ctx.projectInfo.framework !== "sveltekit") return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // matches goto('https://...') or goto("http://...")
    const gotoExternal = /\bgoto\s*\(\s*['"`]https?:\/\//;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = gotoExternal.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-goto-external",
        severity: "warning",
        message: noGotoExternal.message,
        help: noGotoExternal.help,
        line: i + 1,
        column: match.index + 1,
        category: "SvelteKit",
      });
    }

    return diagnostics;
  },
};

// flags form actions that read formData without any validation
const formActionNoValidation: Rule = {
  name: "form-action-no-validation",
  category: "SvelteKit",
  severity: "warning",
  message: "Form action reads `formData` without apparent input validation",
  help: "Validate form data with a schema library (zod, valibot, yup, joi, arktype) or manual type checks (typeof, instanceof) before using it.",
  appliesTo: ["script"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    // applies to both .ts and .js server files
    if (!/\+page\.server\.(ts|js)$/.test(ctx.filePath)) return [];
    if (!/formData/.test(ctx.source)) return [];

    // bail out if any recognised validation pattern is present anywhere in the file
    const validationPatterns = /\b(?:parse|validate|safeParse|zod|yup|valibot|joi|arktype|typeof|instanceof|z\.)\b/;
    if (validationPatterns.test(ctx.source)) return [];

    const lines = ctx.source.split("\n");

    // report once per file, anchored to the first formData occurrence
    for (let i = 0; i < lines.length; i++) {
      if (!/formData/.test(lines[i])) continue;

      return [{
        filePath: ctx.filePath,
        rule: "form-action-no-validation",
        severity: "warning",
        message: formActionNoValidation.message,
        help: formActionNoValidation.help,
        line: i + 1,
        column: lines[i].indexOf("formData") + 1,
        category: "SvelteKit",
      }];
    }

    return [];
  },
};

// checks if the project has a root +error.svelte page for graceful error handling
const missingErrorPage: Rule = {
  name: "missing-error-page",
  category: "SvelteKit",
  severity: "warning",
  message: "No root `+error.svelte` page found — unhandled errors will show SvelteKit's default error page.",
  help: "Create `src/routes/+error.svelte` to provide a custom error page for your users.",
  appliesTo: ["svelte"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (ctx.projectInfo.framework !== "sveltekit") return [];

    // anchor the check to the root layout so it fires exactly once per project
    if (!/src\/routes\/\+layout\.svelte$/.test(ctx.filePath)) return [];

    const errorPagePath = path.join(ctx.projectInfo.rootDirectory, "src", "routes", "+error.svelte");

    try {
      const stat = fs.lstatSync(errorPagePath);
      // a symlinked error page counts as present for this check
      if (stat.isFile() || stat.isSymbolicLink()) return [];
    } catch {
      // file does not exist — fall through to report the diagnostic
    }

    return [{
      filePath: ctx.filePath,
      rule: "missing-error-page",
      severity: "warning",
      message: missingErrorPage.message,
      help: missingErrorPage.help,
      line: 1,
      column: 1,
      category: "SvelteKit",
    }];
  },
};

const serverLoadMissingErrorGuard: Rule = {
  name: "server-load-missing-error-guard",
  category: "SvelteKit",
  severity: "warning",
  message: "Server load function fetches remote data without obvious error handling",
  help: "Wrap remote calls in try/catch or normalize failures with `error()` / fallback data to avoid leaking raw server exceptions.",
  appliesTo: ["script"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!/\+(page|layout)\.server\.(ts|js)$/.test(ctx.filePath)) return [];
    if (!/\bload\b/.test(ctx.source) || !/\bfetch\s*\(/.test(ctx.source)) return [];
    if (/try\s*\{/.test(ctx.source) || /\berror\s*\(/.test(ctx.source)) return [];

    for (let i = 0; i < ctx.lines.length; i++) {
      if (!/\bfetch\s*\(/.test(ctx.lines[i])) continue;
      return [{
        filePath: ctx.filePath,
        rule: serverLoadMissingErrorGuard.name,
        severity: serverLoadMissingErrorGuard.severity,
        message: serverLoadMissingErrorGuard.message,
        help: serverLoadMissingErrorGuard.help,
        line: i + 1,
        column: ctx.lines[i].indexOf("fetch") + 1,
        category: serverLoadMissingErrorGuard.category,
      }];
    }

    return [];
  },
};

const formActionMissingAuthCheck: Rule = {
  name: "form-action-missing-auth-check",
  category: "SvelteKit",
  severity: "warning",
  message: "Form action may be mutating data without an obvious auth/session check",
  help: "Sensitive actions should check `locals`, `cookies`, or session/auth state before processing mutations.",
  appliesTo: ["script"],
  cost: "low",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!/\+page\.server\.(ts|js)$/.test(ctx.filePath)) return [];
    if (!/\bactions\s*=/.test(ctx.source) && !/\bexport\s+const\s+actions\b/.test(ctx.source)) return [];
    if (/\b(locals|cookies|getSession|requireAuth|requireUser|isAuthenticated)\b/.test(ctx.source)) return [];

    return [{
      filePath: ctx.filePath,
      rule: formActionMissingAuthCheck.name,
      severity: formActionMissingAuthCheck.severity,
      message: formActionMissingAuthCheck.message,
      help: formActionMissingAuthCheck.help,
      line: 1,
      column: 1,
      category: formActionMissingAuthCheck.category,
    }];
  },
};



export const sveltekitRules: Rule[] = [
  noClientFetch,
  loadMissingType,
  noGotoExternal,
  formActionNoValidation,
  missingErrorPage,
  serverLoadMissingErrorGuard,
  formActionMissingAuthCheck,
];
