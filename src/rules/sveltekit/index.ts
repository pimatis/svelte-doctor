import fs from "node:fs";
import path from "node:path";
import type { Rule, Diagnostic, RuleContext } from "../../types.js";

// Flags fetch() calls inside .svelte component scripts so use load() or form actions instead.
const noClientFetch: Rule = {
  name: "no-client-fetch",
  category: "SvelteKit",
  severity: "warning",
  message: "Avoid `fetch()` in component scripts and use SvelteKit `load` functions or form actions instead.",
  help: "Move data fetching to `+page.ts` / `+page.server.ts` load functions, or use form actions for mutations.",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (ctx.projectInfo.framework !== "sveltekit") return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];
    if (/\+(page|layout)\.server/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const fetchPattern = /\bfetch\s*\(/;

    let insideScript = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith("<script")) { insideScript = true; continue; }
      if (trimmed.startsWith("</script>")) { insideScript = false; continue; }

      if (!insideScript) continue;
      if (!fetchPattern.test(lines[i])) continue;
      if (/action|submit/.test(lines[i])) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-client-fetch",
        severity: "warning",
        message: noClientFetch.message,
        help: noClientFetch.help,
        line: i + 1,
        column: lines[i].indexOf("fetch") + 1,
        category: "SvelteKit",
      });
    }

    return diagnostics;
  },
};

// ensures load functions have explicit type annotations for type safety
const loadMissingType: Rule = {
  name: "load-missing-type",
  category: "SvelteKit",
  severity: "warning",
  message: "Load function is missing a type annotation or `satisfies` clause",
  help: "Add a type annotation like `export const load: PageLoad = ...` or use `satisfies PageLoad` for full type inference.",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!/\+(page|layout)\.(ts|server\.ts)$/.test(ctx.filePath)) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // catches load declarations without a colon (type annotation) or satisfies keyword
    const loadDeclaration = /export\s+(const|function)\s+load\b/;

    for (let i = 0; i < lines.length; i++) {
      if (!loadDeclaration.test(lines[i])) continue;
      if (/:\s*\w+/.test(lines[i].split("load")[1] ?? "")) continue;
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

// Prevents using goto() with external URLs so use window.location or anchor tags instead.
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
    const gotoExternal = /goto\s*\(\s*['"`]https?:\/\//;

    for (let i = 0; i < lines.length; i++) {
      if (!gotoExternal.test(lines[i])) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: "no-goto-external",
        severity: "warning",
        message: noGotoExternal.message,
        help: noGotoExternal.help,
        line: i + 1,
        column: lines[i].indexOf("goto") + 1,
        category: "SvelteKit",
      });
    }

    return diagnostics;
  },
};

// flags form actions that read formData without any validation library or type guard
const formActionNoValidation: Rule = {
  name: "form-action-no-validation",
  category: "SvelteKit",
  severity: "warning",
  message: "Form action reads `formData` without apparent input validation",
  help: "Validate form data with a schema library (zod, valibot, yup, joi) or manual type checks (typeof, instanceof) before using it.",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!/\+page\.server/.test(ctx.filePath)) return [];
    if (!/formData/.test(ctx.source)) return [];

    // bail out if any validation pattern is present anywhere in the file
    const validationPatterns = /\b(parse|validate|safeParse|zod|yup|valibot|joi|typeof|instanceof)\b/;
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
  message: "No root `+error.svelte` page found so unhandled errors will show SvelteKit's default error page.",
  help: "Create `src/routes/+error.svelte` to provide a custom error page for your users.",
  check: (ctx: RuleContext): Diagnostic[] => {
    if (!/src\/routes\/\+layout\.svelte$/.test(ctx.filePath)) return [];

    const errorPagePath = path.join(ctx.projectInfo.rootDirectory, "src", "routes", "+error.svelte");

    if (fs.existsSync(errorPagePath)) return [];

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
