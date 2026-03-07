<p align="center">
  <img src="assets/logos/logo.png" width="64" height="64" alt="svelte-doctor logo">
</p>

<h1 align="center">svelte-doctor</h1>

<p align="center">
  <a href="#installation">
    <strong>Installation</strong>
  </a>
  &nbsp;•&nbsp;
  <a href="#usage">
    <strong>Usage</strong>
  </a>
  &nbsp;•&nbsp;
  <a href="#commands">
    <strong>Commands</strong>
  </a>
  &nbsp;•&nbsp;
  <a href="#rules">
    <strong>Rules</strong>
  </a>
  &nbsp;•&nbsp;
  <a href="#configuration">
    <strong>Configuration</strong>
  </a>
</p>

<p align="center">
  <strong>Diagnose and fix performance, correctness, and architecture issues in your Svelte codebase</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/svelte-doctor">
    <img src="https://img.shields.io/npm/v/svelte-doctor.svg" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/svelte-doctor">
    <img src="https://img.shields.io/npm/dm/svelte-doctor.svg" alt="npm downloads">
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="license">
  </a>
</p>

## Overview

`svelte-doctor` is a comprehensive diagnostic tool that analyzes your Svelte projects for security vulnerabilities, performance bottlenecks, architectural issues, and Svelte 4-to-5 migration patterns.

Run a single command to scan your entire codebase and receive a **0–100 health score** with actionable, line-specific diagnostics.

### Key Features

- **33 Diagnostic Rules** covering correctness, performance, security, and architecture
- **AI-Powered Auto-Fix** integration with Amp, Claude Code, and Codex
- **Svelte 4→5 Auto-Migration** with deterministic codemods
- **Live Watch Mode** for continuous development feedback
- **Dependency Health Checks** for ecosystem compatibility
- **Zero Configuration** works out of the box

---

## Installation

### Global Installation (Recommended)

Install `svelte-doctor` globally to use it from anywhere in your terminal.

```bash
# Using bun (recommended)
bun i -g svelte-doctor

# Using npm
npm install -g svelte-doctor

# Using pnpm
pnpm add -g svelte-doctor
```

**Add to PATH (Required for first-time setup):**

If you get a "command not found" error after installation, add the global bin folder to your PATH:

**macOS / Linux:**
```bash
# For Bun users
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc  # or ~/.bashrc
source ~/.zshrc  # or source ~/.bashrc

# For npm users (usually automatic, but if needed)
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Windows:**
```powershell
# For Bun users - run in PowerShell as Administrator
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:USERPROFILE\.bun\bin", "User")

# For npm users - usually automatic
# If needed, add: %APPDATA%\npm to your PATH
```

### Local Installation

You can also install it locally in your project:

```bash
# Using bun
bun i -D svelte-doctor

# Using npm
npm install -D svelte-doctor

# Using pnpm
pnpm add -D svelte-doctor
```

Then run with:
```bash
# Using npx / bunx
npx svelte-doctor
bunx svelte-doctor

# Or via package.json scripts
"scripts": {
  "doctor": "svelte-doctor check"
}
```

---

## Usage

```bash
# Scan your project
svelte-doctor check

# Just the score (useful for CI)
svelte-doctor check --score

# Auto-fix issues with an AI agent
svelte-doctor fix

# Auto-migrate Svelte 4 → Svelte 5
svelte-doctor migrate

# Watch for changes and show live score
svelte-doctor watch

# Show score history and trend
svelte-doctor trend

# Check dependency health
svelte-doctor deps
```

---

## Commands

### `svelte-doctor check [directory] [options]`

Scan your project for issues and output a health score. Every run saves the score to `.svelte-doctor/history.json`, including `--json` and `--score` modes, so your CI pipeline contributes to the trend graph.

| Option | Description |
|--------|-------------|
| `--score` | Output only the numeric score |
| `--json` | Output machine-readable JSON |
| `--no-lint` | Skip lint rules |
| `--no-dead-code` | Skip dead code detection |

### `svelte-doctor fix [directory] [options]`

Detects installed AI coding agents (**Cursor**, **Amp**, **Claude Code**, **Codex**) and uses the best available one to fix all reported issues automatically. Cursor is invoked via its CLI (`agent` command; install from [cursor.com/cli](https://cursor.com/cli)). Diagnostics are sent via stdin. Runs verification after fixes; warns if errors increased. If no agent is installed, the prompt is saved to a temp file for manual use.

| Option | Description |
|--------|-------------|
| `--agent <name>` | Force a specific agent (cursor, amp, claude, codex) |
| `--errors-only` | Fix only errors first (reduces cascade errors, run again for warnings) |

### `svelte-doctor migrate [directory] [options]`

Auto-migrate Svelte 4 syntax to Svelte 5. Deterministic, AST-free codemod that transforms legacy patterns in-place.

**Transformations:**
- `$:` reactive statements → `$derived()` / `$effect()`
- `export let` → `let { ... } = $props()`
- `<slot>` → `{@render children()}`
- `<slot name="x">` → `{@render x?.()}`
- `on:click={handler}` → `onclick={handler}`
- `createEventDispatcher` → callback props (with TODO comment)
- `let:` directives → snippet props (with TODO comment)
- Legacy lifecycle imports → `$effect()` (with TODO comment)

| Option | Description |
|--------|-------------|
| `--dry-run` | Show changes without modifying files |
| `--no-backup` | Skip creating .svelte.bak backup files |

### `svelte-doctor watch [directory] [options]`

Watch for file changes and show live diagnostics. Runs an initial full scan, then incrementally re-scans only changed files with 150ms debounced updates.

```
[12:34:56] src/Component.svelte changed — Score: 82 → 78 (⚠ 2 issues)
[12:34:59] src/Layout.svelte changed — Score: 78 → 80 (✓ score improved +2)
```

### `svelte-doctor trend [directory] [options]`

Show score history and trend over time. Every `check` run automatically saves the score to `.svelte-doctor/history.json`. The `trend` command visualizes this data as a terminal bar chart.

| Option | Description |
|--------|-------------|
| `-n, --last <count>` | Number of recent entries to show (default: 20) |

```
  Score History (last 10 runs)

  100 ┤
   90 ┤          ██
   80 ┤      ██  ██  ██
   70 ┤  ██  ██  ██  ██  ██
      └──────────────────────
        Jan 15  Jan 16  Jan 17

  Latest: 85 (Good) ↑ +7 from first run
  Best:   92 (Excellent)  Worst: 62 (Needs Work)
```

### `svelte-doctor deps [directory] [options]`

Check dependency health for Svelte ecosystem compatibility. Fully offline — no network requests.

**Checks:**
- **Deprecated packages** — sapper, svelte-routing, svelte-preprocess, etc.
- **Svelte 5 compatibility** — packages not updated for runes/snippets
- **Risky version ranges** — `*` or `latest` dependencies
- **Better alternatives** — axios → fetch, moment → dayjs, lodash → lodash-es

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |

---

## Rules (33)

### Correctness (7)

Rules in this category only fire in **runes-mode projects** (projects that use `$state`, `$derived`, `$effect`, or `$props`). They flag Svelte 4 patterns that are broken or deprecated in Svelte 5.

| Rule | Severity | Description |
|------|----------|-------------|
| `no-legacy-reactive` | error | `$:` reactive statements → `$derived` / `$effect` |
| `no-legacy-lifecycle` | error | `onMount`/`onDestroy` imports → `$effect` |
| `no-export-let` | error | `export let` → `$props()` |
| `no-event-dispatcher` | error | `createEventDispatcher` → callback props |
| `no-legacy-slots` | error | `<slot>` → `{@render children()}` |
| `no-let-directive` | error | `let:` directive → snippet props |
| `no-on-directive` | warning | `on:event` → `onevent` attributes |

### Performance (4)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-effect-for-derived` | warning | `$effect` used where `$derived` fits |
| `each-missing-key` | warning | `{#each}` without key expression |
| `no-inline-object` | warning | Inline objects/arrays in template expressions |
| `no-transition-all` | warning | `transition: all` is expensive |

### Architecture (4)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-giant-component` | warning | Component exceeds 300 lines |
| `no-deep-nesting` | warning | More than 3 levels of template block nesting |
| `no-console` | warning | `console.*` left in components |
| `no-multi-script` | warning | Multiple instance `<script>` blocks |

### Security (4)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-unsafe-html` | error | `{@html}` is an XSS vector |
| `no-secrets` | error | Hardcoded API keys / tokens |
| `no-eval` | error | `eval()` usage |
| `no-public-env-secrets` | error | Secrets imported from public `$env` modules |

### SvelteKit (5)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-client-fetch` | warning | `fetch` in component scripts → use `load` functions |
| `load-missing-type` | warning | Load function without type annotation (TypeScript only) |
| `no-goto-external` | warning | `goto()` with external URLs |
| `form-action-no-validation` | warning | Form actions without input validation |
| `missing-error-page` | warning | No `+error.svelte` found |

### Bundle Size (3)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-barrel-import` | warning | Barrel imports prevent tree-shaking |
| `no-full-lodash` | warning | Full `lodash` import (~70kb) |
| `no-moment` | warning | `moment.js` is heavy (~300kb) |

### Accessibility (3)

| Rule | Severity | Description |
|------|----------|-------------|
| `img-missing-alt` | warning | `<img>` without `alt` attribute |
| `click-needs-keyboard` | warning | Click handler on non-interactive element without keyboard support |
| `anchor-no-content` | warning | `<a>` without text content or `aria-label` |

### State & Reactivity (3)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-unnecessary-state` | warning | `$state` wrapping a value that is never mutated |
| `no-derived-side-effect` | error | Side effects inside `$derived` |
| `prefer-runes` | warning | `svelte/store` imports in a runes-mode project |

---

## Node.js API

```typescript
import { diagnose } from "svelte-doctor/api";

const result = await diagnose("./path/to/your/svelte-project");

console.log(result.score);        // { score: 82, label: "Good" }
console.log(result.diagnostics);  // Diagnostic[]
console.log(result.project);      // ProjectInfo
```

---

## Configuration

Create `svelte-doctor.config.json` in your project root:

```json
{
  "ignore": {
    "rules": ["no-console"],
    "files": ["src/legacy/"]
  },
  "lint": true,
  "deadCode": true
}
```

Or add a `"svelte-doctor"` key in `package.json`:

```json
{
  "svelte-doctor": {
    "ignore": {
      "rules": ["no-console"]
    }
  }
}
```

---

## License

This project has been developed under the [Apache License 2.0](./LICENSE).

<p align="center">
  Built by <a href="https://github.com/Pimatis"><strong>Pimatis</strong></a>
</p>
