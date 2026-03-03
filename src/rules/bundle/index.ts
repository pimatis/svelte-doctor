import type { Rule, Diagnostic } from "../../types.js";

// catches barrel imports that bypass tree-shaking by pulling entire directories
// or explicit index files which have the same effect
const noBarrelImport: Rule = {
  name: "no-barrel-import",
  category: "Bundle Size",
  severity: "warning",
  message: "Barrel import detected — import from the direct file path instead",
  help: "Import from the specific file: `import { Button } from './components/Button'` instead of `./components` or `./components/index`. Barrel files prevent tree-shaking and inflate bundle size.",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // matches named imports from a relative path
    const importPattern = /import\s+(?:type\s+)?\{[^}]+\}\s+from\s+['"](\.[^'"]*)['"]/;

    // directory names that commonly serve as barrel roots
    const barrelDirPattern = /\/(components|lib|utils|helpers|stores|actions|hooks|composables|modules)(?:\/index)?$/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = importPattern.exec(lines[i]);
      if (!match) continue;

      const importPath = match[1];

      // a path with a file extension is always a direct import — skip it
      if (/\.\w+$/.test(importPath)) continue;

      // flag paths that end with a known barrel directory or .../dir/index
      if (!barrelDirPattern.test(importPath)) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noBarrelImport.name,
        severity: noBarrelImport.severity,
        message: noBarrelImport.message,
        help: noBarrelImport.help,
        line: i + 1,
        column: match.index + 1,
        category: noBarrelImport.category,
      });
    }

    return diagnostics;
  },
};

// full lodash import ships the entire library (~70kb) even if you use one function
const noFullLodashImport: Rule = {
  name: "no-full-lodash",
  category: "Bundle Size",
  severity: "warning",
  message: "Full lodash import detected — import specific functions instead",
  help: "Import the specific function: `import debounce from 'lodash/debounce'` or use `lodash-es` for tree-shaking. A full `lodash` import adds ~70kb to your bundle.",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // matches: import _ from 'lodash'  or  import { debounce } from 'lodash'
    // does NOT match: import debounce from 'lodash/debounce'
    const fullLodashPattern = /from\s+['"]lodash['"]/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      if (!fullLodashPattern.test(lines[i])) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noFullLodashImport.name,
        severity: noFullLodashImport.severity,
        message: noFullLodashImport.message,
        help: noFullLodashImport.help,
        line: i + 1,
        column: 1,
        category: noFullLodashImport.category,
      });
    }

    return diagnostics;
  },
};

// moment.js is unmaintained and ships ~300kb — lighter alternatives exist
const noMoment: Rule = {
  name: "no-moment",
  category: "Bundle Size",
  severity: "warning",
  message: "`moment.js` is heavy (~300kb) and unmaintained — use `date-fns` or `dayjs` instead",
  help: "Replace with `import { format } from 'date-fns'` (tree-shakeable, ~13kb per function) or `import dayjs from 'dayjs'` (2kb). Both are actively maintained.",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    const momentPattern = /from\s+['"]moment['"]/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      if (!momentPattern.test(lines[i])) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noMoment.name,
        severity: noMoment.severity,
        message: noMoment.message,
        help: noMoment.help,
        line: i + 1,
        column: 1,
        category: noMoment.category,
      });
    }

    return diagnostics;
  },
};

// importing all icons from a top-level icon package entry ships every icon in the set
const noFullIconImport: Rule = {
  name: "no-full-icon-import",
  category: "Bundle Size",
  severity: "warning",
  message: "Top-level icon package import detected — import individual icons instead",
  help: "Replace `import * as Icons from 'phosphor-svelte'` with individual named imports: `import { House, User } from 'phosphor-svelte'`. Wildcard imports prevent tree-shaking and bundle every icon in the set.",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    // only flag wildcard (namespace) imports from icon packages — named imports are fine
    // because modern bundlers tree-shake them correctly
    const wildcardIconPattern = /import\s+\*\s+as\s+\w+\s+from\s+['"](?:phosphor-svelte|@phosphor-icons\/svelte|lucide-svelte|heroicons\/svelte)['"]/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = wildcardIconPattern.exec(lines[i]);
      if (!match) continue;

      // skip when the match falls inside a string literal — this prevents false
      // positives from regex source strings or documentation containing the package name
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
        rule: noFullIconImport.name,
        severity: noFullIconImport.severity,
        message: noFullIconImport.message,
        help: noFullIconImport.help,
        line: i + 1,
        column: match.index + 1,
        category: noFullIconImport.category,
      });
    }

    return diagnostics;
  },
};

export const bundleRules: Rule[] = [
  noBarrelImport,
  noFullLodashImport,
  noMoment,
  noFullIconImport,
];