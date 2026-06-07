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

- **57 Source Diagnostic Rules** covering correctness, performance, security, architecture, SvelteKit reliability, runtime performance, hydration safety, and CSS specificity
- **Build Artifact Diagnostics** for SvelteKit output chunks, duplicate libraries, oversized bundles, and inline base64 assets
- **TypeScript AST-backed script analysis** for lower false-positive rates on security-sensitive checks
- **Deterministic Safe Apply** via `apply` for high-confidence fixes — covers CSS transitions, lodash/moment/icon imports, Svelte 4→5 migration, unnecessary `$state` wrappers, and `$effect` to `$derived` conversions
- **Baseline Suppression** to keep legacy issues out of new CI failures
- **Interactive Project Bootstrap** via `init` for config, CI, scripts, baseline, and `.gitignore` setup
- **SARIF + GitHub Annotations** for code scanning and CI integration
- **PR Check Workflow** for branch diff analysis and GitHub PR summary comments
- **Diff-Aware and Workspace-Aware Scans** for staged files, changed files, and monorepos
- **Safe-by-default AI Fix** flow with secure temp prompts, opt-in unsafe execution, post-fix verification, and support for Cursor, Amp, Claude Code, Codex, Copilot CLI, OpenCode, Pi, Gemini CLI, Qwen Code, Aider, and Goose
- **AI-Friendly Copy Export** via `check --copy` with clipboard-first fallback behavior
- **Svelte 4→5 Auto-Migration** with deterministic codemods
- **Migration Progress Tracking** via `migrate-status` with migrated/pending/skipped counts, category breakdown, and ETA
- **Smart Ignore Suggestions** via `suggest-ignore` with confidence scoring and generated ignore config snippets
- **Component Dependency Graphs** via `graph` with ASCII, DOT, JSON, and circular dependency detection
- **Bundle Impact Preview** via `bundle-impact` for estimated savings from fixable bundle-size diagnostics
- **Test Coverage Gap Finder** via `test-gaps` for source-to-test matching and SvelteKit critical path checks
- **Rule Authoring Kit** via `create-rule` for custom rule, test, and docs scaffolding
- **Component Render Profiler** via `render-profile` for compile-time DOM, reactivity, hydration, and re-render cost ranking
- **Cached Scans + Incremental Watch** for faster repeat checks and tighter feedback loops
- **Automatic `.gitignore` Sync** for generated `.svelte-doctor/*` cache/history files while preserving tracked baseline negations
- **Dependency Health Checks and Upgrade Planning** for ecosystem compatibility and npm registry updates
- **Quick Health Check** via `quick` for fast error-only scans with instant score feedback
- **Security Audit** via `audit` for focused security-only scans with a dedicated security score
- **Ref Comparison** via `compare` for diagnosing regressions between commits, branches, and tags
- **Project Metrics** via `stats` for rule frequency, category breakdown, and top affected files
- **Config Inspection** via `config` and `validate` for viewing and validating the active configuration
- **Environment Diagnosis** via `doctor` to check Node.js, Svelte, config, and project setup health
- **Generated File Cleanup** via `reset` to safely clear cache, baseline, and history
- **Single-Command Scan + Fix** via `check --fix` for one-step diagnostic and deterministic auto-fix
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

# Bootstrap config, scripts, CI, gitignore, and baseline
svelte-doctor init

# Non-interactive bootstrap with GitHub Actions
svelte-doctor init --yes --ci github-actions

# Force a cold scan without cache
svelte-doctor check --no-cache

# Copy diagnostics into an AI-friendly prompt
svelte-doctor check --copy

# Just the score (useful for CI)
svelte-doctor check --score

# Scan only changed files
svelte-doctor check --changed

# Scan all workspaces in a monorepo
svelte-doctor check --all-workspaces

# Generate a baseline from current issues
svelte-doctor baseline

# Apply safe deterministic fixes
svelte-doctor apply --write

# Auto-fix issues with an AI agent
svelte-doctor fix

# Force Copilot CLI (runs: copilot -p "<prompt>")
svelte-doctor fix --agent copilot

# Generate a secure prompt without spawning an agent
svelte-doctor fix --dry-run-prompt

# Update the global CLI from npm
svelte-doctor update

# Check whether a newer version exists
svelte-doctor update --check

# Auto-migrate Svelte 4 → Svelte 5
svelte-doctor migrate

# Track Svelte 4 → 5 migration progress
svelte-doctor migrate-status
svelte-doctor migrate-status --json

# Suggest likely false-positive ignores
svelte-doctor suggest-ignore
svelte-doctor suggest-ignore --json

# Preview bundle savings from fixable diagnostics
svelte-doctor bundle-impact
svelte-doctor bundle-impact --json

# Build a component dependency graph
svelte-doctor graph
svelte-doctor graph --format dot
svelte-doctor graph --format json

# Find source files without matching tests
svelte-doctor test-gaps
svelte-doctor test-gaps --json

# Scaffold a custom rule, test, and docs
svelte-doctor create-rule no-custom-pattern

# Rank the most expensive components before runtime
svelte-doctor render-profile
svelte-doctor render-profile --top 10
svelte-doctor render-profile --watch
svelte-doctor render-profile --json

# Watch for changes and show live score
svelte-doctor watch

# Show score history and trend
svelte-doctor trend

# Check dependency health
svelte-doctor deps

# Check npm registry for dependency upgrades without writing files
svelte-doctor upgrade --dry-run

# Analyze current branch against main for PR/CI feedback
svelte-doctor pr-check --base main --head HEAD

# List rules or explain one in detail
svelte-doctor rules
svelte-doctor explain no-unsafe-shell

# Quick health check (errors only, fast)
svelte-doctor quick
svelte-doctor quick --score

# Security-focused audit
svelte-doctor audit
svelte-doctor audit --score

# Project metrics and statistics
svelte-doctor stats
svelte-doctor stats --top 5

# Compare diagnostics between two git refs
svelte-doctor compare --base main --head HEAD
svelte-doctor compare --base v1.0.0 --head v2.0.0

# View active configuration
svelte-doctor config
svelte-doctor config --json

# Validate config file for errors
svelte-doctor validate
svelte-doctor validate --json

# Check your development environment
svelte-doctor doctor

# Clean generated files
svelte-doctor reset
svelte-doctor reset --cache

# Scan and apply deterministic fixes in one step
svelte-doctor check --fix
svelte-doctor check --fix --dry-run
svelte-doctor check --fix --fix-ai
```

---

## Commands

### `svelte-doctor doctor [directory] [options]`

Check your development environment for common issues — inspired by `flutter doctor`. Diagnoses Node.js version, Svelte dependency presence, `svelte.config.js` configuration, `tsconfig.json` validity, `node_modules` installation state, `svelte-doctor.config.json` schema validation, `.gitignore` completeness, build artifact freshness, and scan cache status.

Each check returns one of four statuses: **pass**, **warning**, **fail**, or **na** (not applicable). The command exits with code 1 if any check fails, making it suitable for CI onboarding gates.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor doctor
svelte-doctor doctor packages/app
svelte-doctor doctor --json
```

### `svelte-doctor init [directory] [options]`

Bootstrap an existing Svelte project for `svelte-doctor`. The command probes the project with the same discovery path used by scans, writes `svelte-doctor.config.json`, syncs `.gitignore`, injects package scripts, optionally creates a CI workflow, and can create an initial diagnostic baseline.

Generated defaults:

- `svelte-doctor.config.json`
- `.svelte-doctor/*` entry in `.gitignore`
- `package.json` scripts: `doctor` and `doctor:fix`
- optional CI file for GitHub Actions, GitLab CI, or CircleCI
- optional `.svelte-doctor/baseline.json`
- optional direct `.git/hooks/pre-commit` hook

| Option | Description |
|--------|-------------|
| `--ci <github-actions\|gitlab-ci\|circle-ci>` | Generate CI config for the selected platform |
| `--force` | Overwrite existing `svelte-doctor.config.json` and generated CI file |
| `-y, --yes` | Accept defaults without prompts |

Examples:

```bash
svelte-doctor init
svelte-doctor init --yes
svelte-doctor init --yes --ci github-actions
svelte-doctor init packages/app --ci gitlab-ci
```

### `svelte-doctor check [directory] [options]`

Scan your project for issues and output a health score. The scanner analyzes source files, Svelte compiler output, and existing SvelteKit build artifacts under `.svelte-kit/output/` when that directory exists. Every run saves the score to `.svelte-doctor/history.json`, including `--json` and `--score` modes, so your CI pipeline contributes to the trend graph. When `svelte-doctor` first creates its local `.svelte-doctor/` directory, it also ensures the scanned project's `.gitignore` contains a `.svelte-doctor/*` entry unless an equivalent `.svelte-doctor` or `.svelte-doctor/*` pattern already exists.

| Option | Description |
|--------|-------------|
| `--score` | Output only the numeric score |
| `--json` | Output machine-readable JSON |
| `--no-lint` | Skip lint rules |
| `--no-dead-code` | Skip dead code detection |
| `--no-cache` | Disable the on-disk scan cache for this run |
| `--copy` | Export diagnostics in an AI-friendly format |
| `--copy-output <clipboard\|stdout\|file>` | Choose clipboard, stdout, or file output |
| `--copy-file <path>` | Write export output to a file inside the scanned project root |
| `--copy-max <count>` | Limit how many diagnostics are included in the export |
| `--copy-errors-only` | Export only error-level diagnostics |
| `--copy-format <prompt\|raw>` | Export as a structured prompt or raw text |
| `--baseline` | Suppress diagnostics present in `.svelte-doctor/baseline.json` |
| `--sarif` | Emit SARIF output |
| `--sarif-file <path>` | Write SARIF output to a file |
| `--html` | Write an interactive HTML report to `.svelte-doctor/report.html` |
| `--html-file <path>` | Write HTML report to a custom file |
| `--junit` | Write a JUnit XML report to `.svelte-doctor/junit.xml` |
| `--junit-file <path>` | Write JUnit XML report to a custom file |
| `--markdown` | Write a Markdown report to `.svelte-doctor/report.md` |
| `--markdown-file <path>` | Write Markdown report to a custom file |
| `--github-annotations` | Emit GitHub Actions annotation commands |
| `--fail-on <never\|error\|warning>` | Control exit behavior |
| `--min-score <score>` | Fail if score is below the threshold |
| `--changed` | Scan files changed relative to `HEAD` |
| `--staged` | Scan staged files only |
| `--since <ref>` | Scan files changed since a git ref |
| `--all-workspaces` | Scan all package.json workspaces |
| `--workspace <name>` | Scan one workspace by name or relative path |
| `--fix` | Apply deterministic auto-fixes after scan |
| `--fix-ai` | Also run AI agent fix after deterministic fixes |
| `--dry-run` | With `--fix`: preview fixes without writing files |
| `--rules <csv>` | With `--fix`: limit deterministic fixes to comma-separated rules |
| `--errors-only` | With `--fix`: fix only error-severity diagnostics |
| `--verify-level <level>` | With `--fix-ai`: verification depth — `diagnostics`, `typecheck`, `tests`, or `full` |
| `--max-files <count>` | With `--fix-ai`: max diagnostics in AI agent batch (default: 50) |

`--copy` is designed for cases where you want to paste diagnostics into a different AI agent instead of using `svelte-doctor fix`. The default mode tries the system clipboard first, then falls back to stdout if no clipboard integration is available. If you need deterministic output for scripts, use `--copy-output file`.

Rich reports also work with `--all-workspaces` and `--workspace`. Workspace reports aggregate diagnostics into one file and prefix paths with the workspace directory, such as `packages/app/src/App.svelte`.

Examples:

```bash
svelte-doctor check --copy
svelte-doctor check --copy --copy-errors-only
svelte-doctor check --copy --copy-output stdout
svelte-doctor check --copy --copy-output file --copy-file .svelte-doctor/diagnostics.txt
svelte-doctor check --changed
svelte-doctor check --sarif --sarif-file .svelte-doctor/report.sarif
svelte-doctor check --html --html-file .svelte-doctor/report.html
svelte-doctor check --junit --junit-file .svelte-doctor/junit.xml
svelte-doctor check --markdown --markdown-file .svelte-doctor/report.md
svelte-doctor check --all-workspaces --html --junit --markdown

# Scan and apply fixes in one step
svelte-doctor check --fix
svelte-doctor check --fix --dry-run
svelte-doctor check --fix --errors-only
svelte-doctor check --fix --fix-ai --verify-level tests
```

### `svelte-doctor baseline [directory]`

Create `.svelte-doctor/baseline.json` from the current diagnostics so future checks can suppress already-known issues with `check --baseline`.

Examples:

```bash
svelte-doctor baseline
svelte-doctor baseline --changed
svelte-doctor baseline --all-workspaces
```

### `svelte-doctor apply [directory] [options]`

Apply deterministic, high-confidence fixes without launching an AI agent. This command is intentionally conservative and only rewrites patterns the tool can fix safely.

**Supported fixes:**
- `no-transition-all` — replaces `transition: all` with explicit `opacity` and `transform`
- `no-full-lodash` — rewrites full lodash imports to per-function paths
- `no-moment` — replaces `moment` imports with `dayjs`
- `no-full-icon-import` — converts namespace icon imports to named imports
- Svelte 4→5 migration rules (`no-legacy-reactive`, `no-export-let`, `no-legacy-slots`, `no-on-directive`, `no-event-dispatcher`, `no-let-directive`, `no-legacy-lifecycle`)
- `no-unnecessary-state` — strips `$state()` wrapper from values that are never mutated
- `no-effect-for-derived` — converts `$effect(() => { x = expr })` to `const x = $derived(expr)`

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview changes without writing files |
| `--write` | Write changes to disk |
| `--json` | Output machine-readable JSON |
| `--rules <csv>` | Restrict fixes to specific rule names |
| `--changed` | Apply fixes only on files changed relative to `HEAD` |
| `--staged` | Apply fixes only on staged files |
| `--since <ref>` | Apply fixes only on files changed since a git ref |

Examples:

```bash
svelte-doctor apply --write
svelte-doctor apply --dry-run
svelte-doctor apply --write --rules no-transition-all,no-full-lodash
```

### `svelte-doctor fix [directory] [options]`

Detects installed AI coding agents (**Cursor**, **Amp**, **Claude Code**, **Codex**, **Copilot CLI**, **OpenCode**, **Pi**, **Gemini CLI**, **Qwen Code**, **Aider**, **Goose**) and uses the best available one to fix reported issues automatically. The flow is **safe by default**: privileged agent flags are disabled unless you explicitly pass `--unsafe-agent-exec`. Diagnostics are redacted before prompt generation, prompts are written into a secure temp directory when needed, and post-fix verification can be escalated from diagnostics-only to full typecheck/test/build smoke.

Supported agent ids for `--agent` are `cursor`, `amp`, `claude`, `codex`, `copilot`, `opencode`, `pi`, `gemini`, `qwen`, `aider`, and `goose`. Install and authenticate at least one of them first, then run `svelte-doctor fix`. The command uses each agent's documented non-interactive mode where available: Amp execute mode, Claude print mode, Codex exec mode, Copilot prompt mode, OpenCode run mode, Pi print mode, Gemini headless mode, Qwen headless mode, Aider message mode, and Goose run mode.

```bash
# Use the best installed agent
svelte-doctor fix

# Force a specific agent
svelte-doctor fix --agent amp
svelte-doctor fix --agent claude
svelte-doctor fix --agent codex
svelte-doctor fix --agent copilot
svelte-doctor fix --agent opencode
svelte-doctor fix --agent pi
svelte-doctor fix --agent gemini
svelte-doctor fix --agent qwen
svelte-doctor fix --agent aider
svelte-doctor fix --agent goose

# Preview the prompt if you want to paste it manually
svelte-doctor fix --dry-run-prompt
```

| Option | Description |
|--------|-------------|
| `--agent <name>` | Force a specific agent (cursor, amp, claude, codex, copilot, opencode, pi, gemini, qwen, aider, goose) |
| `--errors-only` | Fix only errors first (reduces cascade errors, run again for warnings) |
| `--unsafe-agent-exec` | Opt in to agent-specific privileged execution flags |
| `--dry-run-prompt` | Generate the secure prompt bundle without spawning an agent |
| `--verify-level <level>` | Verification depth: `diagnostics`, `typecheck`, `tests`, `full` |
| `--max-files <count>` | Limit how many diagnostics are sent in a single agent batch |

Supported agents under `src/agents`:

| Agent id | CLI command | Non-interactive mode |
|----------|-------------|----------------------|
| `cursor` | `agent` | `--print --workspace <cwd> --output-format stream-json` |
| `amp` | `amp` | `-x` execute mode, unsafe opt-in via `--dangerously-allow-all` |
| `claude` | `claude` | `-p --output-format stream-json --include-partial-messages` |
| `codex` | `codex` | `exec -C <cwd>`, unsafe opt-in via bypass flag |
| `copilot` | `copilot` | `-p` |
| `opencode` | `opencode` | `run` |
| `pi` | `pi` | `-p` |
| `gemini` | `gemini` | `-p`, unsafe opt-in via `--yolo` |
| `qwen` | `qwen` | `-p`, unsafe opt-in via `--yolo` |
| `aider` | `aider` | `--yes --no-auto-commits --message` |
| `goose` | `goose` | `run --no-session --quiet -t` |

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

### `svelte-doctor migrate-status [directory] [options]`

Show Svelte 4 to 5 migration progress without modifying files. The command scans `.svelte` files for pending legacy patterns and reports migrated, pending, and skipped file counts, category-specific progress, and an estimated remaining time.

Tracked categories:

- reactive statements (`$:`)
- `export let` props
- legacy `<slot>` usage
- `on:event` directives

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor migrate-status
svelte-doctor migrate-status --json
```

### `svelte-doctor suggest-ignore [directory] [options]`

Generate smart ignore suggestions for diagnostics that are likely false positives or low-risk noise. Each suggestion includes a confidence score, the reason it was flagged, and an ignore config snippet you can review before copying into `svelte-doctor.config.json`.

This is intentionally advisory. It does not write config automatically.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON with suggestions and config |

Examples:

```bash
svelte-doctor suggest-ignore
svelte-doctor suggest-ignore --json
```

### `svelte-doctor graph [directory] [options]`

Build a component dependency graph from local imports and rendered component tags. The graph helps answer which component imports or renders another component and highlights circular dependencies.

| Option | Description |
|--------|-------------|
| `--format <ascii\|dot\|json>` | Output format, defaults to `ascii` |

Examples:

```bash
svelte-doctor graph
svelte-doctor graph --format dot > graph.dot
svelte-doctor graph --format json
```

### `svelte-doctor bundle-impact [directory] [options]`

Estimate potential bundle savings from fixable bundle-size diagnostics. Current estimates cover heavy imports such as `moment`, full `lodash`, and wildcard icon package imports.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor bundle-impact
svelte-doctor bundle-impact --json
```

### `svelte-doctor test-gaps [directory] [options]`

Find source files that do not have a nearby matching test file. It also marks critical SvelteKit paths, such as server load modules and form actions, so CI can prioritize missing tests for production-sensitive code.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor test-gaps
svelte-doctor test-gaps --json
```

### `svelte-doctor create-rule <name> [directory] [options]`

Scaffold a custom rule package with a rule template, test template, and docs template. Rule names must be kebab-case, for example `no-custom-pattern`. Existing files are never overwritten.

Generated files:

- `src/rules/custom/<name>/index.ts`
- `src/rules/custom/<name>/README.md`
- `test/<name>.test.mjs`

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor create-rule no-custom-pattern
svelte-doctor create-rule no-custom-pattern --json
```

### `svelte-doctor render-profile [directory] [options]`

Analyze Svelte components before runtime and rank the most expensive render surfaces. The profiler parses and compiles each `.svelte` file, then combines AST and compiled-output signals into a deterministic render cost model.

Per component metrics:

- DOM node count
- reactive dependency count
- hydration complexity score
- re-render risk factor
- compiled output size
- aggregate render cost

The default terminal output lists the top 10 most expensive components. `--watch` re-runs the profile when `.svelte` files change and shows cost deltas, which helps catch render-cost regressions before a build reaches production.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |
| `--top <count>` | Number of expensive components to show, defaults to 10 |
| `--watch` | Watch `.svelte` files and show render cost changes |

Examples:

```bash
svelte-doctor render-profile
svelte-doctor render-profile --top 5
svelte-doctor render-profile --watch
svelte-doctor render-profile --json
```

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

Monorepos can also query the latest trend snapshot per workspace with `--all-workspaces` or `--workspace <name>`.

### `svelte-doctor rules`

List every built-in rule with its category and whether it supports deterministic autofix.

### `svelte-doctor explain <rule>`

Explain what a rule checks, why it matters, and what the safest remediation looks like.

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

### `svelte-doctor upgrade [directory] [options]`

Check project dependencies against the npm registry and prepare safe upgrade suggestions. By default, major upgrades are excluded. Use `--dry-run` to report without touching `package.json`; without `--dry-run`, accepted suggestions are written atomically and the detected package manager runs install.

The upgrade plan includes current version, lockfile-resolved version when available, latest version, wanted range, dependency block, major/minor/patch classification, deprecation signal, replacement alternative when known, breaking-change flag, changelog/repository URL when available, and risk score.

| Option | Description |
|--------|-------------|
| `--dry-run` | Report upgrades without writing `package.json` or lockfile |
| `--interactive` | Ask before applying each package upgrade (`y`, `n`, `a`, `q`) |
| `--major` | Include major-version upgrades |
| `--json` | Output machine-readable JSON |
| `--all-workspaces` | Check every package.json workspace |
| `--workspace <name>` | Check one workspace by name or relative path |

Examples:

```bash
svelte-doctor upgrade --dry-run
svelte-doctor upgrade --dry-run --major
svelte-doctor upgrade --json
svelte-doctor upgrade --all-workspaces --dry-run
```

### `svelte-doctor pr-check [directory] [options]`

Analyze a branch diff for PR or CI feedback. The command lists files changed between `--base` and `--head`, scans isolated git worktrees for both refs, builds a Markdown PR summary, and can post that summary or review to GitHub with the `gh` CLI. When posting to GitHub, it also writes a `svelte-doctor` commit status for required-check workflows.

| Option | Description |
|--------|-------------|
| `--pr <number>` | Pull request number for comment posting |
| `--base <branch>` | Base branch or ref (default: `main`) |
| `--head <branch>` | Head branch or ref (default: `HEAD`) |
| `--comment` | Post a summary comment via GitHub CLI |
| `--inline` | Submit a GitHub PR review with the generated summary |
| `--fail-on <never\|error\|warning>` | Control exit behavior for new issues |
| `--min-score <score>` | Fail if PR score is below the threshold |
| `--json` | Output machine-readable JSON |
| `--platform <github\|gitlab\|bitbucket\|auto>` | Select PR platform adapter mode |
| `--token <env-var>` | Token environment variable name (default: `GITHUB_TOKEN`) |

Examples:

```bash
svelte-doctor pr-check --base main --head HEAD
svelte-doctor pr-check --base origin/main --head HEAD --min-score 80
svelte-doctor pr-check --pr 42 --comment --platform github
svelte-doctor pr-check --json
```

### `svelte-doctor update [options]`

Checks the official npm registry for the latest `svelte-doctor` version and updates the **global CLI installation**. This command does not update local project dependencies.

| Option | Description |
|--------|-------------|
| `--check` | Check for an update without installing |
| `--dry-run` | Print the global install command without running it |
| `--manager <npm|pnpm|bun>` | Override package manager detection |
| `--tag <latest>` | Release tag to install (`latest` only) |
| `--json` | Output machine-readable JSON |

### `svelte-doctor quick [directory] [options]`

Fast error-only scan with health score. Runs a lint scan with cache enabled and dead-code detection disabled for maximum speed. Only error-level diagnostics are reported, making it ideal for quick pre-commit checks or rapid feedback during development.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |
| `--score` | Output only the numeric score |

Examples:

```bash
svelte-doctor quick
svelte-doctor quick --score
svelte-doctor quick packages/app --json
```

### `svelte-doctor compare [directory] [options]`

Compare diagnostics between two git refs (commits, branches, tags). Creates temporary git worktrees for both refs, runs independent scans, and reports the score delta along with newly introduced and fixed diagnostics. The comparison is symmetric: it shows both what got worse and what improved.

| Option | Description |
|--------|-------------|
| `--base <ref>` | Base git ref (commit, branch, tag) (default: `main`) |
| `--head <ref>` | Head git ref (default: `HEAD`) |
| `--json` | Output machine-readable JSON |

Git refs are validated for injection-safe characters. Temporary worktrees are created in the OS temp directory and cleaned up automatically, even on scan failure.

Examples:

```bash
svelte-doctor compare --base main --head HEAD
svelte-doctor compare --base v1.0.0 --head v2.0.0
svelte-doctor compare --base HEAD~5 --head HEAD --json
svelte-doctor compare --base origin/main --head feature/xyz
```

### `svelte-doctor stats [directory] [options]`

Show project metrics including total diagnostics by severity, category breakdown with error/warning counts and penalty weights, most frequently triggered rules, and most affected files. Useful for identifying systemic patterns and prioritizing cleanup efforts.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |
| `--top <count>` | Number of top items to show per list (default: `10`) |

Examples:

```bash
svelte-doctor stats
svelte-doctor stats --top 5
svelte-doctor stats --json
svelte-doctor stats --top 3 --json
```

### `svelte-doctor audit [directory] [options]`

Security-focused scan that runs the full lint pipeline but filters results to only the Security category. Computes a dedicated security score from the filtered diagnostics. Useful for compliance checks, security reviews, and CI gates that focus exclusively on security posture.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |
| `--score` | Output only the security score |

Security rules include XSS via `{@html}`, hardcoded secrets, `eval()` usage, insecure cookies, broad CORS, shell injection, server secret leaks, dangerous redirect parameters, and public env secret imports.

Examples:

```bash
svelte-doctor audit
svelte-doctor audit --score
svelte-doctor audit --json
svelte-doctor audit packages/api --json
```

### `svelte-doctor config [directory] [options]`

Display the active `svelte-doctor` configuration. Reads from `svelte-doctor.config.json` first, then falls back to the `"svelte-doctor"` key in `package.json`. Shows all active settings including lint, dead-code, cache, watch, fix, reports, and ignore rules.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |
| `--path` | Show only the config file path |

Examples:

```bash
svelte-doctor config
svelte-doctor config --json
svelte-doctor config --path
```

### `svelte-doctor validate [directory] [options]`

Validate the `svelte-doctor.config.json` file for syntax and schema errors. Checks for invalid JSON syntax, unknown top-level and nested keys, type mismatches (e.g., string where boolean expected), invalid enum values (e.g., `watch.deadCode`, `fix.verifyLevel`), empty report paths, and malformed ignore lists with non-string elements.

| Option | Description |
|--------|-------------|
| `--json` | Output machine-readable JSON |

Validation covers:
- **Unknown keys** at all nesting levels
- **Type checks** for `lint`, `deadCode`, `cache`, `watch`, `fix`, `reports`, `ignore`
- **Enum validation** for `watch.deadCode` (`off`/`lazy`/`full`), `fix.verifyLevel` (`diagnostics`/`typecheck`/`tests`/`full`)
- **Numeric bounds** for `fix.maxFiles` (must be positive)
- **Path validation** for `reports.html`, `reports.junit`, `reports.markdown` (must be non-empty strings)
- **Array validation** for `ignore.rules` and `ignore.files` (must be arrays of non-empty strings)
- **Symlink detection** — refuses to validate symlinked config files

Examples:

```bash
svelte-doctor validate
svelte-doctor validate --json
svelte-doctor validate packages/app
```

### `svelte-doctor reset [directory] [options]`

Clean generated files (cache, baseline, score history) inside `.svelte-doctor/`. Useful when cache gets corrupted, baseline becomes stale, or you want to start fresh without manually deleting files.

By default (no flags), all generated files are removed and the `.svelte-doctor/` directory is cleaned up if empty afterwards.

| Option | Description |
|--------|-------------|
| `--all` | Clean everything in `.svelte-doctor/` (default if no flag) |
| `--cache` | Clean only scan cache |
| `--baseline` | Clean only baseline |
| `--history` | Clean only score history |
| `--dry-run` | Show what would be deleted without deleting |
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor reset
svelte-doctor reset --dry-run
svelte-doctor reset --cache
svelte-doctor reset --baseline --history
svelte-doctor reset --all --json
```

---

## Rules (57 source rules + 3 build artifact diagnostics)

### Correctness (7)

Rules in this category only fire in **runes-mode projects** (projects that use `$state`, `$derived`, `$effect`, or `$props`). They flag Svelte 4 patterns that are broken or deprecated in Svelte 5.

| Rule | Severity | Description |
|------|----------|-------------|
| `no-legacy-reactive` | error | `$:` reactive statements → `$derived` / `$effect` (fixable) |
| `no-legacy-lifecycle` | error | `onMount`/`onDestroy` imports → `$effect` (fixable) |
| `no-export-let` | error | `export let` → `$props()` (fixable) |
| `no-event-dispatcher` | error | `createEventDispatcher` → callback props (fixable) |
| `no-legacy-slots` | error | `<slot>` → `{@render children()}` (fixable) |
| `no-let-directive` | error | `let:` directive → snippet props (fixable) |
| `no-on-directive` | warning | `on:event` → `onevent` attributes (fixable) |

### Performance (20)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-effect-for-derived` | warning | `$effect` used where `$derived` fits (fixable) |
| `each-missing-key` | warning | `{#each}` without key expression |
| `no-inline-object` | warning | Inline objects/arrays in template expressions |
| `no-transition-all` | warning | `transition: all` is expensive (fixable) |
| `no-large-inline-list-transform` | warning | Expensive `.filter().map().sort()` chains in template markup |
| `no-repeated-derived-allocation` | warning | Repeated allocations inside `$derived()` |
| `no-blocking-sync-fs-in-hot-cli-path` | warning | Sync fs calls in hot scan paths |
| `prefer-lazy-deadcode-phase` | warning | Full dead-code scans configured in fast feedback paths |
| `too-many-effects` | warning | Compiler output contains many reactive effects in one component |
| `effect-without-cleanup` | warning | `$effect` registers listeners, timers, or subscriptions without cleanup |
| `derived-with-side-effect` | warning | `$derived` contains DOM, storage, timer, or network side effects |
| `deep-template-tree` | warning | Compiled template is deeply nested and may mount/hydrate slowly |
| `no-hydration-mismatch-template-values` | warning | Template uses browser-only, random, or time-based values that can mismatch SSR |
| `no-inline-event-handler` | warning | Inline event handler creates a new function reference |
| `no-expensive-derived` | warning | `$derived` performs heavy parsing, sorting, regex, or repeated filtering |
| `no-high-specificity` | warning | CSS selector specificity is too high |
| `no-deep-css-nesting` | warning | CSS selector nesting is too deep |
| `no-id-selector` | warning | ID selector creates high specificity in component styles |
| `no-important-override` | warning | CSS uses `!important` override |
| `no-style-tag-props` | warning | Inline style attribute can conflict with CSP and maintainability |

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

### Bundle Size (4 source rules + 3 build artifact diagnostics)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-barrel-import` | warning | Barrel imports prevent tree-shaking |
| `no-full-lodash` | warning | Full `lodash` import (~70kb) (fixable) |
| `no-moment` | warning | `moment.js` is heavy (~300kb) (fixable) |
| `no-full-icon-import` | warning | Wildcard icon imports prevent tree-shaking (fixable) |
| `chunk-size-limit` | warning | Build output chunk exceeds recommended size limit |
| `no-duplicate-lib-in-chunks` | warning | Same package appears across multiple generated chunks |
| `prefer-dynamic-import` | warning | Large dependency appears in an eagerly loaded build chunk |
| `no-base64-inline-asset` | warning | Build output contains inline base64 image data |

### Accessibility (3)

| Rule | Severity | Description |
|------|----------|-------------|
| `img-missing-alt` | warning | `<img>` without `alt` attribute |
| `click-needs-keyboard` | warning | Click handler on non-interactive element without keyboard support |
| `anchor-no-content` | warning | `<a>` without text content or `aria-label` |

### State & Reactivity (3)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-unnecessary-state` | warning | `$state` wrapping a value that is never mutated (fixable) |
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
  },
  "reports": {
    "html": ".svelte-doctor/report.html",
    "junit": ".svelte-doctor/junit.xml",
    "markdown": ".svelte-doctor/report.md"
  }
}
```

The `reports` block writes reports on every `check` run, even without `--html`, `--junit`, or `--markdown` flags. This also applies to workspace scans, where reports are written at the root project and include all prefixed workspace diagnostics. Report writes are symlink-hardened and create parent directories when needed.

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
