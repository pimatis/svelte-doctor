# Writing svelte-doctor plugins & rules

This guide explains how to extend `svelte-doctor` with custom rules and share them as
plugins. It also documents the **security model** behind plugin loading so you can adopt
the system safely in CI and pre-commit hooks.

- For a quick reference of the config keys, see the _Plugins & Community Rules_ section in
  the [main README](../README.md).
- The plugin loader source lives in [`src/plugins/loader.ts`](../src/plugins/loader.ts).

---

## 1. Security model (read this first)

Plugin code executes **inside the svelte-doctor process with the same privileges as the CLI**.
A rule's `check`/`fix` can read or write any file the user can, spawn processes, and make
network calls. The loader applies the following controls to keep that power in check:

| Control                          | Behavior                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No silent npm auto-execution** | Packages in `node_modules` are **not** scanned or executed automatically. A plugin only runs when it is listed under `plugins.include` (or when you explicitly opt into `plugins.autoDiscoverNpm`). This prevents a compromised or typosquatted dependency from running code during your scan. |
| **Local rules are trusted**      | Files under `svelte-doctor.rules/` are auto-loaded because they live in your own repository (same trust boundary as the source being scanned). They are still validated and sandboxed to the project root.                                                                                     |
| **Explicit opt-in (`include`)**  | npm plugins must be named in config. This is the recommended, auditable way to adopt third-party rules.                                                                                                                                                                                        |
| **Kill-switch**                  | Set the `SD_DISABLE_PLUGINS` environment variable to any value to run built-in rules only. Useful in CI to get a reproducible baseline.                                                                                                                                                        |
| **`plugins: false`**             | Disable every plugin/local rule from config.                                                                                                                                                                                                                                                   |
| **Hook isolation**               | A plugin that throws during `check` or `fix` is reported as a warning and **never aborts the scan or the fix run**. One bad rule cannot break the whole tool.                                                                                                                                  |
| **Namespacing**                  | Every custom rule gets a stable id `<namespace>/<rule-name>` (e.g. `svelte-doctor-plugin-a11y-plus/no-broken-anchor`). Two plugins can never silently collide, and every diagnostic records its exact origin.                                                                                  |
| **Transparency**                 | `svelte-doctor plugins` lists every loaded plugin with its source (`local` or `npm`), package name, version, entry path, and whether it was auto-discovered.                                                                                                                                   |

### Adopting third-party plugins safely

1. Review the package source before installing. Prefer packages maintained by people you trust.
2. Pin an exact version (`"svelte-doctor-plugin-x": "1.2.3"`) instead of a floating range.
3. List it under `plugins.include` so the load is explicit and auditable in git history.
4. Run `SD_DISABLE_PLUGINS=1 svelte-doctor check .` in CI if you want a plugin-free baseline.

`registry add` prints a security notice and reminds you to opt in via config; it does **not**
auto-wire the plugin.

---

## 2. Local rules (fastest path)

Scaffold a rule that is auto-discovered on every scan:

```bash
svelte-doctor create-rule no-custom-pattern
```

This writes `svelte-doctor.rules/no-custom-pattern.mjs` plus a test. The file is a normal
ES module that default-exports a `Rule`:

```js
/**
 * @type {import("svelte-doctor").Rule}
 */
export default {
  name: "no-custom-pattern",
  category: "Correctness",
  severity: "warning",
  message: "Custom pattern detected",
  help: "Replace this placeholder with actionable guidance.",
  docs: {
    summary: "Describe what this rule detects.",
    whyItMatters: "Explain the production risk or maintainability impact.",
    safeFix: "Document the recommended fix.",
  },
  check: (ctx) => {
    const diagnostics = [];
    for (let i = 0; i < ctx.lines.length; i++) {
      if (/console\.\w+/.test(ctx.lines[i])) {
        diagnostics.push({
          filePath: ctx.filePath,
          rule: "no-custom-pattern",
          severity: "warning",
          message: "Avoid console output in components",
          help: "Remove the console call or use the project logger.",
          line: i + 1,
          column: 1,
          category: "Correctness",
        });
      }
    }
    return diagnostics;
  },
  // optional: fix: (source, diagnostic) => string
};
```

Local rule ids are namespaced as `local/<name>` (so `no-custom-pattern` becomes
`local/no-custom-pattern`). You can ignore one with
`{ "ignore": { "rules": ["local/no-custom-pattern"] } }`.

### Supported export shapes

A local file (or a plugin entry) may export any of the following:

- a single default-exported `Rule`
- a default-exported plugin object `{ name, rules }`
- a named `svelteDoctorPlugin` export
- a default-exported array of `Rule`

The helpers `defineRule`, `definePlugin`, and `validateRule` (all exported from the
`svelte-doctor` package) validate the shape at author time and throw a clear error if a
field is wrong.

---

## 3. The `Rule` shape

```ts
interface Rule {
  name: string; // kebab-case, unique within its plugin
  id?: string; // set by the loader: "<namespace>/<name>" for custom rules
  category: RuleCategory; // one of the categories below
  severity: "error" | "warning";
  message: string; // short, shown on the diagnostic
  help: string; // actionable guidance
  appliesTo?: ("svelte" | "script" | "all")[]; // default: ["all"]
  requiresAst?: boolean; // only run when an AST is available
  cost?: "low" | "medium" | "high";
  autofixable?: boolean;
  docs?: { summary?: string; whyItMatters?: string; safeFix?: string };
  check: (ctx: RuleContext) => Diagnostic[];
  fix?: (source: string, diagnostic: Diagnostic) => string;
}
```

`RuleCategory` is one of:
`Correctness`, `Performance`, `Architecture`, `SvelteKit`, `Security`, `Bundle Size`,
`Dead Code`, `Accessibility`, `State & Reactivity`.

---

## 4. `RuleContext` (what `check` receives)

```ts
interface RuleContext {
  filePath: string; // relative path (posix)
  projectRoot: string; // absolute project root
  source: string; // raw file contents
  compiledSource?: string; // compiled output when available
  lines: string[]; // source split by line
  fileKind: "svelte" | "script";
  ast: any; // parsed AST (script and markup)
  scriptBlocks: ScriptAstContext[];
  projectInfo: ProjectInfo;
  analysisMeta: { hasScript: boolean; hasStyle: boolean };
}
```

For Svelte files the `ast` exposes both the markup and the `<script>` blocks. For plain
`.ts`/`.js` files `fileKind` is `"script"`. Use `requiresAst: true` when your rule needs the
AST so it is skipped on files where parsing failed.

### `Diagnostic` shape

`check` returns `Diagnostic[]`. Required fields:

```ts
interface Diagnostic {
  filePath: string;
  rule: string; // use the same value you passed to the rule; the loader overrides it with the namespaced id
  severity: "error" | "warning";
  message: string;
  help: string;
  line: number; // 1-based
  column: number; // 1-based
  category: RuleCategory;
  weight?: number;
  fingerprint?: string;
  fixable?: boolean;
  plugin?: string;
}
```

---

## 5. Authoring a fix

When a rule exposes `fix`, `svelte-doctor apply` can rewrite the file deterministically.
`fix` receives the full file `source` and the `diagnostic`, and must return the new source
(ideally a minimal, targeted edit).

```js
fix: (source, diagnostic) => {
  const lines = source.split("\n");
  // remove the offending line reported by the diagnostic
  lines.splice(diagnostic.line - 1, 1);
  return lines.join("\n");
};
```

Set `autofixable: true` on the rule so the engine reports it as fixable and
`explain` advertises the safe fix.

---

## 6. Publishing a plugin (npm)

A plugin is an npm package. The conventional name is `svelte-doctor-plugin-<topic>`
(for example `svelte-doctor-plugin-a11y-plus`). Publish it and list it under
`plugins.include` in the consuming project's config.

```js
// svelte-doctor-plugin-a11y-plus/index.js
import { definePlugin } from "svelte-doctor";

export default definePlugin({
  name: "a11y-plus",
  rules: [
    {
      name: "no-broken-anchor",
      category: "Accessibility",
      severity: "warning",
      message: "Anchor is missing an accessible label",
      help: "Add aria-label or text content.",
      check: (ctx) => [],
    },
  ],
});
```

### Namespacing

Each rule in this package is exposed as `svelte-doctor-plugin-a11y-plus/no-broken-anchor`.
The namespace is the full npm package name, so two plugins can never collide. Built-in rules
keep bare ids (`a11y-alt-text`), so they are always distinct from plugin rules.

### Loading a scoped or non-conventional package

If your package is scoped (`@my-org/svelte-doctor-plugin-internal`) or does not follow the
naming convention, still list it under `plugins.include` — the loader resolves any package
you name explicitly:

```jsonc
{
  "plugins": {
    "include": ["@my-org/svelte-doctor-plugin-internal"],
  },
}
```

---

## 7. Configuration reference

```jsonc
{
  "plugins": {
    "enabled": true, // set false to disable all plugins/local rules
    "include": ["svelte-doctor-plugin-a11y-plus"], // explicit npm plugins to load
    "exclude": ["svelte-doctor-plugin-legacy"], // disable specific packages
    "autoDiscoverNpm": false, // opt-in scan of node_modules (off by default)
    "local": ["svelte-doctor.rules/**/*.{mjs,js,cjs}"], // local rule globs
  },
}
```

| Key               | Default                                 | Purpose                                                                                                                        |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`         | `true`                                  | When `false`, built-in rules only.                                                                                             |
| `include`         | `[]`                                    | npm package names to load. The recommended way to adopt plugins.                                                               |
| `exclude`         | `[]`                                    | package names to skip entirely.                                                                                                |
| `autoDiscoverNpm` | `false`                                 | When `true`, every `svelte-doctor-plugin-*` dependency is executed. Off by default because it runs arbitrary third-party code. |
| `local`           | `svelte-doctor.rules/**/*.{mjs,js,cjs}` | Globs for project-local rule files.                                                                                            |

Environment variable: `SD_DISABLE_PLUGINS` (any value) forces built-in rules only.

---

## 8. Catalog & `registry` commands

`svelte-doctor` ships an offline catalog of community plugins in
[`src/plugins/catalog.ts`](../src/plugins/catalog.ts). Add your plugin by opening a pull
request that appends an entry.

```bash
svelte-doctor registry list
svelte-doctor registry search a11y
svelte-doctor registry info a11y-plus
svelte-doctor registry add a11y-plus          # installs via your package manager
svelte-doctor registry add a11y-plus --dry-run
```

`registry add` installs the package but does **not** enable it; add it to
`plugins.include` yourself after reviewing the source.

---

## 9. Inspecting what is loaded

```bash
svelte-doctor plugins          # active plugins + local rule folders (source, version, paths)
svelte-doctor plugins --json
svelte-doctor rules            # all rules, grouped by built-in / plugin / local
svelte-doctor explain <rule>   # shows the namespaced id and source plugin
```

---

## 10. Troubleshooting

- **My npm plugin is not loading.** Plugins are not auto-discovered. Add the package name to
  `plugins.include` (or set `autoDiscoverNpm: true` and accept the security trade-off).
- **"shadowed by an existing rule" warning.** Two rules resolved to the same id
  (`<namespace>/<name>`). Rename one of them.
- **"does not export a valid svelte-doctor plugin".** The entry must default-export a `Rule`,
  a plugin object, a `svelteDoctorPlugin` named export, or an array of `Rule`, and every rule
  must pass `validateRule`.
- **A rule throws and the scan continues.** That is expected: the failure is isolated to a
  warning and the rest of the scan proceeds.
- **Need a plugin-free run.** Run with `SD_DISABLE_PLUGINS=1`.
