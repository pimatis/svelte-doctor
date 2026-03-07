import fs from "node:fs";
import path from "node:path";
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

// flags fetch() calls inside .svelte component scripts
// data fetching belongs in load() functions or form actions, not component scripts
const noClientFetch: Rule = {
  name: "no-client-fetch",
  category: "SvelteKit",
  severity: "warning",
  message: "Avoid `fetch()` in component scripts — use SvelteKit `load` functions or form actions instead.",
  help: "Move data fetching to `+page.ts` / `+page.server.ts` load functions, or use form actions for mutations.",
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
  check: (ctx: RuleContext): Diagnostic[] => {
    // only applies to SvelteKit route files
    if (!/\+(page|layout)\.(ts|server\.ts|js|server\.js)$/.test(ctx.filePath)) return [];

    // type annotations only exist in TypeScript — skip JS projects entirely
    if (!ctx.projectInfo.hasTypeScript) return [];

    // pure .js files cannot carry type annotations
    if (ctx.filePath.endsWith(".js")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // catches load declarations without a colon (type annotation) or satisfies keyword
    const loadDeclaration = /export\s+(const|function)\s+load\b/;

    for (let i = 0; i < lines.length; i++) {
      const declarationMatch = loadDeclaration.exec(lines[i]);
      if (!declarationMatch) continue;

      // check for ": TypeName" strictly after the "load" keyword, not inside
      // an unrelated identifier that contains "load"
      const afterLoad = lines[i].slice(declarationMatch.index + declarationMatch[0].length);
      if (/:\s*\w+/.test(afterLoad)) continue;

      // satisfies keyword is also acceptable
      if (/satisfies/.test(lines[i])) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "load-missing-type",
        severity: "warning",
        message: loadMissingType.message,
        help: loadMissingType.help,
        line: i + 1,
        column: lines[i].indexOf("load") + 1,
        category: "SvelteKit",
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



export const sveltekitRules: Rule[] = [
  noClientFetch,
  loadMissingType,
  noGotoExternal,
  formActionNoValidation,
  missingErrorPage,
];