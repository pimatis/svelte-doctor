import type { Rule, Diagnostic } from "../../types.js";

// catches barrel imports that bypass tree-shaking by pulling entire directories
const noBarrelImport: Rule = {
  name: "no-barrel-import",
  category: "Bundle Size",
  severity: "warning",
  message: "Barrel import detected so import from the direct path instead",
  help: "Import from the specific file: `import { Button } from './components/Button'` instead of `./components`. Barrel files can prevent tree-shaking",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const barrelMatch = lines[i]
        .trim()
        .match(
          /import\s+\{[^}]+\}\s+from\s+['"](\.\.[^'"]*|\.\/[^'"]*)['"]/,
        );
      if (!barrelMatch) continue;

      const importPath = barrelMatch[1];

      // flag only when path ends with a known directory name and has no file extension
      if (
        !importPath.match(/\.\w+$/) &&
        importPath.match(
          /\/(components|lib|utils|helpers|stores|actions)$/,
        )
      )
        diagnostics.push({
          filePath: ctx.filePath,
          rule: noBarrelImport.name,
          severity: noBarrelImport.severity,
          message: noBarrelImport.message,
          help: noBarrelImport.help,
          line: i + 1,
          column: 1,
          category: noBarrelImport.category,
        });
    }

    return diagnostics;
  },
};

// full lodash import ships the entire library (~70kb) even if you use one function
const noFullLodashImport: Rule = {
  name: "no-full-lodash-import",
  category: "Bundle Size",
  severity: "warning",
  message: "Full lodash import detected — import specific functions",
  help: "Import the specific function like `import debounce from 'lodash/debounce'` which saves ~70kb from your bundle",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().match(/from\s+['"]lodash['"]/)) continue;

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

// Moment.js is unmaintained and ships ~300kb so lighter alternatives exist.
const noMoment: Rule = {
  name: "no-moment",
  category: "Bundle Size",
  severity: "warning",
  message: "`moment.js` is heavy (~300kb) so use `date-fns` or `dayjs` instead",
  help: "Replace with `import { format } from 'date-fns'` (tree-shakeable) or `import dayjs from 'dayjs'` (2kb). moment is also no longer actively maintained",
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().match(/from\s+['"]moment['"]/)) continue;

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

export const bundleRules: Rule[] = [
  noBarrelImport,
  noFullLodashImport,
  noMoment,
];
