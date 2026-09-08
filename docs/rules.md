# Rule Contract

How to write a rule for svelte-doctor — built-in or as a plugin/local rule.

## Rule shape

```ts
import type { Rule, Diagnostic, RuleContext } from "svelte-doctor";

const noFoo: Rule = {
  // kebab-case, unique across built-ins and plugins
  name: "no-foo",
  // one of: Correctness, Performance, Architecture, SvelteKit, Security,
  // Bundle Size, Dead Code, Accessibility, State & Reactivity
  category: "Correctness",
  severity: "warning", // or "error"
  message: "Short one-line description",
  help: "How to fix it",
  // restrict to file kinds (default: both)
  appliesTo: ["svelte"], // or ["script"]
  // "low" | "medium" | "high" — roughly, how long the check takes per file
  cost: "low",
  autofixable: true, // set only when fix is provided
  docs: {
    summary: "Flags foo usage.",
    whyItMatters: "Foo blocks bar.",
    safeFix: "Replace foo with bar.",
  },
  check: (ctx) => {
    const diagnostics: Diagnostic[] = [];
    // ... inspect ctx, push diagnostics
    return diagnostics;
  },
  // optional: pure string transform, applied when the user accepts the fix
  fix: (source, diagnostic) => source.replace(/foo/g, "bar"),
};
```

Both `check` and `fix` must be pure: no I/O, no global state. `check` runs
against every matching file on every scan (also inside worker threads), so keep
it allocation-light; mark expensive checks with `cost`.

A rule-level `autofixable: true` applies to every diagnostic it emits by
default. To mark a single diagnostic non-fixable (for example, when the same
defect is unfixable in a specific context), set `fixable: false` on that
diagnostic — `apply`/`migrate` then skip it.

## RuleContext

`check` receives everything already parsed for the file:

| field            | contents                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filePath`       | absolute path of the scanned file                                                                                                                                                     |
| `projectRoot`    | project root the scan was started from                                                                                                                                                |
| `source`         | full file content                                                                                                                                                                     |
| `lines`          | `source.split("\n")`                                                                                                                                                                  |
| `fileKind`       | `"svelte"` or `"script"`                                                                                                                                                              |
| `ast`            | for `.svelte` files: the Svelte template AST (`parse(src, { modern: true })`); for `.svelte.js`/`.svelte.ts`: the TypeScript `SourceFile` of the first script block; `null` otherwise |
| `scriptBlocks`   | parsed `<script>` blocks with `startLine`, `endLine`, `kind` (`"instance" \| "module" \| "script"`), TypeScript `sourceFile`                                                          |
| `compiledSource` | Svelte compiler JS output, when compilation succeeded                                                                                                                                 |
| `projectInfo`    | framework, Svelte version, runes usage, etc.                                                                                                                                          |
| `analysisMeta`   | `hasScript`, `hasStyle`, `isServerOnly`, `isUniversal`                                                                                                                                |

Prefer walking `ctx.ast` over regex-on-source: template constructs
(`EachBlock`, `ExpressionTag`, `Attribute`, …) appear as AST nodes, which
avoids false positives inside strings and comments. Use `walkAst` from
`parser/walker.js`; use `buildScriptLineMap` / `buildStyleLineMap` /
`offsetToPosition` from `parser/lines.js` when a line-oriented view is needed.

## Diagnostic

```ts
{
  filePath: ctx.filePath,
  rule: noFoo.name,          // must match the rule name
  severity: noFoo.severity,
  message: noFoo.message,
  help: noFoo.help,
  line: 3,                   // 1-based; 0 means "whole file"
  column: 1,                 // 1-based
  category: noFoo.category,
}
```

## Codemod / transform spec

`fix(source, diagnostic)` receives the original file content and the diagnostic
that triggered it, and returns the new content. Requirements:

- return the input unchanged when nothing should change (callers compare strings)
- never throw — a throwing fix aborts the fix pass for that file
- keep the transform local: operate on the region around `diagnostic.line`

For multi-file or interactive rewrites use a fixer in `core/fixers.ts`
instead; those run through the `fix` command's apply/verify pipeline.

## Shipping a rule

- **Local rule**: drop a module in `svelte-doctor.rules/` exporting a rule, a
  rules array, or a plugin object — see `docs/plugins.md`.
- **npm plugin**: publish as `svelte-doctor-plugin-<name>` (or
  `@scope/svelte-doctor-plugin-<name>`) and enable it in
  `svelte-doctor.config.json` → `plugins`.
- **Built-in**: add the rule to the matching category under `src/rules/` and
  export it from its `index.ts`.
