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

- **45 Diagnostic Rules** covering correctness, performance, security, architecture, and SvelteKit reliability
- **Safe-by-default AI Fix** flow with secure temp prompts, opt-in unsafe execution, and post-fix verification
- **Svelte 4→5 Auto-Migration** with deterministic codemods
- **Cached Scans + Incremental Watch** for faster repeat checks and tighter feedback loops
- **Dependency Health Checks** for ecosystem compatibility
- **Zero Configuration** works out of the box

---

## Installation

**Runtime Requirement:** Node.js `22.18.0+`

If you are on Node 18 or Node 20, upgrade Node before installing or building `svelte-doctor`.

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

# Force a cold scan without cache
svelte-doctor check --no-cache

# Just the score (useful for CI)
svelte-doctor check --score

# Auto-fix issues with an AI agent
svelte-doctor fix

# Generate a secure prompt without spawning an agent
svelte-doctor fix --dry-run-prompt

# Update the global CLI from npm
svelte-doctor update

# Check whether a newer version exists
svelte-doctor update --check

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
| `--no-cache` | Disable the on-disk scan cache for this run |

### `svelte-doctor fix [directory] [options]`

Detects installed AI coding agents (**Cursor**, **Amp**, **Claude Code**, **Codex**) and uses the best available one to fix reported issues automatically. The flow is **safe by default**: privileged agent flags are disabled unless you explicitly pass `--unsafe-agent-exec`. Diagnostics are redacted before prompt generation, prompts are written into a secure temp directory when needed, and post-fix verification can be escalated from diagnostics-only to full typecheck/test/build smoke.

| Option | Description |
|--------|-------------|
| `--agent <name>` | Force a specific agent (cursor, amp, claude, codex) |
| `--errors-only` | Fix only errors first (reduces cascade errors, run again for warnings) |
| `--unsafe-agent-exec` | Opt in to agent-specific privileged execution flags |
| `--dry-run-prompt` | Generate the secure prompt bundle without spawning an agent |
| `--verify-level <level>` | Verification depth: `diagnostics`, `typecheck`, `tests`, `full` |
| `--max-files <count>` | Limit how many diagnostics are sent in a single agent batch |

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

Watch for file changes and show live diagnostics. Runs an initial cached scan, then incrementally re-scans only changed files with 150ms debounced updates.

| Option | Description |
|--------|-------------|
| `--dead-code <mode>` | Dead-code behavior in watch mode: `off`, `lazy`, or `full` |

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

### `svelte-doctor update [options]`

Checks the official npm registry for the latest `svelte-doctor` version and updates the **global CLI installation**. This command does not update local project dependencies.

| Option | Description |
|--------|-------------|
| `--check` | Check for an update without installing |
| `--dry-run` | Print the global install command without running it |
| `--manager <npm|pnpm|bun>` | Override package manager detection |
| `--tag <latest>` | Release tag to install (`latest` only) |
| `--json` | Output machine-readable JSON |

---

## Rules (45)

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

### Performance (8)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-effect-for-derived` | warning | `$effect` used where `$derived` fits |
| `each-missing-key` | warning | `{#each}` without key expression |
| `no-inline-object` | warning | Inline objects/arrays in template expressions |
| `no-transition-all` | warning | `transition: all` is expensive |
| `no-large-inline-list-transform` | warning | Expensive `.filter().map().sort()` chains in template markup |
| `no-repeated-derived-allocation` | warning | Repeated allocations inside `$derived()` |
| `no-blocking-sync-fs-in-hot-cli-path` | warning | Sync fs calls in hot scan paths |
| `prefer-lazy-deadcode-phase` | warning | Full dead-code scans configured in fast feedback paths |

### Architecture (4)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-giant-component` | warning | Component exceeds 300 lines |
| `no-deep-nesting` | warning | More than 3 levels of template block nesting |
| `no-console` | warning | `console.*` left in components |
| `no-multi-script` | warning | Multiple instance `<script>` blocks |

### Security (9)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-unsafe-html` | error | `{@html}` is an XSS vector |
| `no-secrets` | error | Hardcoded API keys / tokens |
| `no-eval` | error | `eval()` usage |
| `no-public-env-secrets` | error | Secrets imported from public `$env` modules |
| `no-dangerous-redirect-param` | error | Redirect target comes from untrusted query data |
| `cookie-missing-secure-flags` | error | `cookies.set()` missing `httpOnly` / `secure` / `sameSite` |
| `no-broad-cors` | error | Wildcard CORS or wildcard+credentials configuration |
| `no-server-secret-leak` | error | Private env vars returned from server code |
| `no-unsafe-shell` | error | `exec`, `execSync`, or `spawn(..., { shell: true })` |

### SvelteKit (7)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-client-fetch` | warning | `fetch` in component scripts → use `load` functions |
| `load-missing-type` | warning | Load function without type annotation (TypeScript only) |
| `no-goto-external` | warning | `goto()` with external URLs |
| `form-action-no-validation` | warning | Form actions without input validation |
| `missing-error-page` | warning | No `+error.svelte` found |
| `server-load-missing-error-guard` | warning | Server load uses remote fetch without obvious error handling |
| `form-action-missing-auth-check` | warning | Form actions mutate without an obvious auth/session check |

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
  "deadCode": true,
  "cache": true,
  "watch": {
    "deadCode": "off"
  },
  "fix": {
    "verifyLevel": "diagnostics",
    "maxFiles": 50
  }
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

## Production Use

`svelte-doctor` should be considered production-ready only after:

- `bun run typecheck` passes
- `bun run build` passes
- `npm pack --dry-run` includes `dist/`
- `node ./dist/cli.mjs --version` works

The built-in `fix` flow is safe-by-default, but `--unsafe-agent-exec` is intentionally an opt-in escape hatch and should be treated as a high-trust mode.

This project has been developed under the [Apache License 2.0](./LICENSE).

<p align="center">
  Built by <a href="https://github.com/Pimatis"><strong>Pimatis</strong></a>
</p>
