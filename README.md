<p align="center">
  <img src="assets/logos/logo.png" width="96" height="96" alt="svelte-doctor logo">
</p>

<h1 align="center">svelte-doctor</h1>

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

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Commands](#commands)
- [Configuration](#configuration)
- [Plugins & Community Rules](#plugins--community-rules)
- [Rules](#rules)
- [Node.js API](#nodejs-api)
- [License](#license)

---

## Overview

`svelte-doctor` is a comprehensive diagnostic CLI for Svelte and SvelteKit projects. It analyzes your codebase for security vulnerabilities, performance bottlenecks, architectural issues, and Svelte 4-to-5 migration patterns — then reports everything as a single **0–100 health score** with actionable, line-specific diagnostics.

Run one command to scan your entire project:

```bash
svelte-doctor check
```

The tool is designed to be **safe by default**: deterministic fixes are opt-in, AI agents run in a controlled flow, and CI integration is a first-class citizen (SARIF, GitHub annotations, baseline suppression, and PR checks).

---

## Key Features

### Diagnostics & Scanning

- **78 source diagnostic rules + 3 build artifact diagnostics** covering correctness, performance, security, architecture, SvelteKit reliability, runtime performance, hydration safety, CSS specificity, and accessibility
- **0–100 health score** with actionable, line-specific diagnostics on every scan
- **TypeScript AST-backed script analysis** for lower false-positive rates on security-sensitive checks
- **Cached scans + incremental watch** for faster repeat checks and tighter feedback loops, with `watch --fix` auto-applying deterministic fixes on save
- **Diff-aware and workspace-aware scans** for staged files, changed files, and monorepos
- **Parallel scanning** with `--jobs` for multi-worker file scanning in large codebases, with automatic CPU detection (`--jobs 0`)
- **Focused scan modes** — `quick` (error-only), `audit` (security-only), `compare` (regression analysis), `stats` (project metrics)

### Fixing & Migration

- **Deterministic Safe Apply** via `apply` — covers CSS transitions, lodash/moment/icon imports, Svelte 4→5 migration, unnecessary `$state` wrappers, and `$effect` → `$derived` conversions
- **Svelte 4→5 AST-backed auto-migration** with modular codemods, plan/diff/interactive modes, backups, rollback, staged commits, JSON output, and `.svelte.js` / `.svelte.ts` module file support
- **Migration progress tracking** via `migrate-status` with migrated/pending/skipped counts, category breakdown, and ETA
- **Safe-by-default AI Fix** flow with secure temp prompts, opt-in unsafe execution, post-fix verification, and support for Cursor, Amp, Claude Code, Codex, Copilot CLI, OpenCode, Pi, Gemini CLI, Qwen Code, Aider, and Goose

### CI & Workflows

- **Baseline suppression** to keep legacy issues out of new CI failures
- **Managed Git hooks** via `install-hook` for automatic pre-commit and pre-push quality gates
- **SARIF + GitHub annotations** for code scanning and CI integration
- **PR Check workflow** for branch diff analysis and GitHub PR summary comments
- **Ref comparison** via `compare` for diagnosing regressions between commits, branches, and tags
- **Dependency health checks and upgrade planning** for ecosystem compatibility and npm registry updates

### Insights & Reporting

- **Component dependency graphs** via `graph` with ASCII, DOT, JSON, alias resolution, and circular dependency detection
- **Component where-used lookup** via `where-used` with line-accurate import/render locations, `$lib` and tsconfig alias resolution, dynamic import detection, render trees, scope filtering, and reverse direction
- **Bundle impact preview** via `bundle-impact` for estimated savings from fixable bundle-size diagnostics
- **Dead store detection** via `dead-stores` for `writable` stores never written, with cross-file write tracking and runes migration suggestions
- **Test coverage gap finder** via `test-gaps` for source-to-test matching and SvelteKit critical path checks
- **Component render profiler** via `render-profile` for compile-time DOM, reactivity, hydration, and re-render cost ranking
- **Score history and trends** via `trend` and live feedback via `watch`

### Automation & DX

- **Zero configuration** — works out of the box
- **Interactive project bootstrap** via `init` for config, CI, scripts, baseline, and `.gitignore` setup
- **Single-command scan + fix** via `check --fix`, with `--interactive` for step-by-step approval
- **AI-friendly copy export** via `check --copy` with clipboard-first fallback behavior
- **Smart ignore suggestions** via `suggest-ignore` with confidence scoring and generated config snippets
- **Rule authoring kit** via `create-rule` for custom rule, test, and docs scaffolding
- **Environment diagnosis** via `doctor` with `--fix` to auto-resolve config, gitignore, and dependency issues
- **Automatic `.gitignore` sync** for generated `.svelte-doctor/*` cache/history files while preserving tracked baseline negations
- **Generated file cleanup** via `reset` to safely clear cache, baseline, and history

---

## Quick Start

Get a health score for your project in under a minute:

```bash
# 1. Install the CLI globally (or skip this and use npx / bunx)
bun i -g svelte-doctor          # or: npm install -g svelte-doctor

# 2. Scan your project
svelte-doctor check

# 3. Bootstrap config, CI, and git hooks (recommended)
svelte-doctor init --yes --ci github-actions
svelte-doctor install-hook --mode staged --fail-on error
```

Requires **Node.js 22.18.0+** — see [Installation](#installation) for details.

---

## Installation

**Runtime requirement:** Node.js `22.18.0+`. If you are on Node 18 or Node 20, upgrade Node before installing or building `svelte-doctor`.

### Global Installation (Recommended)

Install `svelte-doctor` globally to use it from anywhere in your terminal:

```bash
# Using bun (recommended)
bun i -g svelte-doctor

# Using npm
npm install -g svelte-doctor

# Using pnpm
pnpm add -g svelte-doctor
```

**Add to PATH (required for first-time setup):**

If you get a `command not found` error after installation, add the global bin folder to your PATH.

**macOS / Linux:**

```bash
# For Bun users
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc  # or ~/.bashrc
source ~/.zshrc  # or source ~/.bashrc

# For npm users (usually automatic, but if needed)
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Windows (PowerShell as Administrator):**

```powershell
# For Bun users
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:USERPROFILE\.bun\bin", "User")

# For npm users - usually automatic; if needed, add %APPDATA%\npm to your PATH
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

Then run with `npx` / `bunx` or a package script:

```bash
# Using npx / bunx
npx svelte-doctor
bunx svelte-doctor
```

```json
"scripts": {
  "doctor": "svelte-doctor check"
}
```

---

## Commands

### Common Workflows

```bash
# First scan
svelte-doctor check

# Bootstrap config, CI, scripts, gitignore, and baseline
svelte-doctor init --yes --ci github-actions

# Install managed pre-commit / pre-push quality gates
svelte-doctor install-hook --mode staged --fail-on error

# Fix issues — deterministic first, then with an AI agent
svelte-doctor check --fix
svelte-doctor fix

# Gate CI on score and warning thresholds
svelte-doctor check --fail-on warning --min-score 80
```

### Command Index

| Command                                                               | Purpose                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| [`init`](#svelte-doctor-init-directory-options)                       | Bootstrap config, CI, scripts, baseline, and gitignore |
| [`install-hook`](#svelte-doctor-install-hook-directory-options)       | Install managed pre-commit / pre-push git hooks        |
| [`pr-check`](#svelte-doctor-pr-check-directory-options)               | Analyze a branch diff for PR / CI feedback             |
| [`doctor`](#svelte-doctor-doctor-directory-options)                   | Diagnose and fix your development environment          |
| [`reset`](#svelte-doctor-reset-directory-options)                     | Clean generated cache, baseline, and history files     |
| [`check`](#svelte-doctor-check-directory-options)                     | Scan the project and output a health score             |
| [`quick`](#svelte-doctor-quick-directory-options)                     | Fast error-only scan with health score                 |
| [`audit`](#svelte-doctor-audit-directory-options)                     | Security-focused scan with a dedicated security score  |
| [`baseline`](#svelte-doctor-baseline-directory)                       | Create a baseline from current diagnostics             |
| [`config`](#svelte-doctor-config-directory-options)                   | Display the active configuration                       |
| [`validate`](#svelte-doctor-validate-directory-options)               | Validate the config file for errors                    |
| [`suggest-ignore`](#svelte-doctor-suggest-ignore-directory-options)   | Suggest likely false-positive ignores                  |
| [`stats`](#svelte-doctor-stats-directory-options)                     | Show project metrics and statistics                    |
| [`compare`](#svelte-doctor-compare-directory-options)                 | Compare diagnostics between two git refs               |
| [`watch`](#svelte-doctor-watch-directory-options)                     | Watch files and show live diagnostics                  |
| [`trend`](#svelte-doctor-trend-directory-options)                     | Show score history and trend                           |
| [`apply`](#svelte-doctor-apply-directory-options)                     | Apply deterministic, safe fixes                        |
| [`fix`](#svelte-doctor-fix-directory-options)                         | Fix issues automatically with an AI agent              |
| [`migrate`](#svelte-doctor-migrate-directory-options)                 | Auto-migrate Svelte 4 → Svelte 5                       |
| [`migrate-status`](#svelte-doctor-migrate-status-directory-options)   | Track Svelte 4 → 5 migration progress                  |
| [`graph`](#svelte-doctor-graph-directory-options)                     | Build a component dependency graph                     |
| [`where-used`](#svelte-doctor-where-used-component-directory-options) | Find every place a component is used                   |
| [`dead-stores`](#svelte-doctor-dead-stores-directory-options)         | Find writable stores that are never written            |
| [`test-gaps`](#svelte-doctor-test-gaps-directory-options)             | Find source files without matching tests               |
| [`bundle-impact`](#svelte-doctor-bundle-impact-directory-options)     | Preview bundle savings from fixable diagnostics        |
| [`render-profile`](#svelte-doctor-render-profile-directory-options)   | Rank the most expensive components                     |
| [`deps`](#svelte-doctor-deps-directory-options)                       | Check dependency health (offline)                      |
| [`upgrade`](#svelte-doctor-upgrade-directory-options)                 | Check the npm registry for dependency upgrades         |
| [`update`](#svelte-doctor-update-options)                             | Update the global CLI installation                     |
| [`rules`](#svelte-doctor-rules-directory)                             | List every rule and its category                       |
| [`explain`](#svelte-doctor-explain-rule-directory-options)            | Explain a rule in detail                               |
| [`create-rule`](#svelte-doctor-create-rule-name-directory-options)    | Scaffold a custom rule, test, and docs                 |

### Setup, CI & Hooks

#### `svelte-doctor init [directory] [options]`

Bootstrap an existing Svelte project for `svelte-doctor`. The command probes the project with the same discovery path used by scans, writes `svelte-doctor.config.json`, syncs `.gitignore`, injects package scripts, optionally creates a CI workflow, and can create an initial diagnostic baseline.

Generated defaults:

- `svelte-doctor.config.json`
- `.svelte-doctor/*` entry in `.gitignore`
- `package.json` scripts: `doctor` and `doctor:fix`
- optional CI file for GitHub Actions, GitLab CI, or CircleCI
- optional `.svelte-doctor/baseline.json`
- optional direct `.git/hooks/pre-commit` hook

| Option                                        | Description                                                          |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `--ci <github-actions\|gitlab-ci\|circle-ci>` | Generate CI config for the selected platform                         |
| `--force`                                     | Overwrite existing `svelte-doctor.config.json` and generated CI file |
| `-y, --yes`                                   | Accept defaults without prompts                                      |

Examples:

```bash
svelte-doctor init
svelte-doctor init --yes
svelte-doctor init --yes --ci github-actions
svelte-doctor init packages/app --ci gitlab-ci
```

#### `svelte-doctor install-hook [directory] [options]`

Install, list, or remove managed git hooks that run `svelte-doctor check` automatically. The command detects direct git hooks, Husky (`.husky/`), and Lefthook (`.lefthook/` or `lefthook.yml`). It chooses `bunx`, `pnpm exec`, or `npx` from the lockfile and only updates hooks that contain the `svelte-doctor managed hook` signature unless `--force` is used.

Use this for low-friction local adoption: developers do not need to remember a scan command before committing. Pair it with CI generated by `svelte-doctor init --ci github-actions` or an equivalent pipeline command such as `bunx svelte-doctor check --fail-on warning --min-score 80` to block PRs when warnings or score regressions appear.

| Option                              | Description                                               |
| ----------------------------------- | --------------------------------------------------------- |
| `--pre-push`                        | Also manage a `pre-push` hook in addition to `pre-commit` |
| `--mode <staged\|changed\|full>`    | Choose scan scope for the hook command                    |
| `--fail-on <never\|error\|warning>` | Control hook exit behavior                                |
| `--min-score <score>`               | Fail if the scan score is below the threshold             |
| `--force`                           | Overwrite an existing non-svelte-doctor hook              |
| `--remove`                          | Remove svelte-doctor managed hooks                        |
| `--list`                            | List managed hook status                                  |
| `--json`                            | Output machine-readable JSON                              |

Examples:

```bash
# Pre-commit only, scans staged files
svelte-doctor install-hook

# Pre-commit and pre-push, full scan with warning gate and score floor
svelte-doctor install-hook --pre-push --mode full --fail-on warning --min-score 80

# Inspect current hook state
svelte-doctor install-hook --list
svelte-doctor install-hook --list --json

# Remove only svelte-doctor managed hooks
svelte-doctor install-hook --remove --pre-push
```

#### `svelte-doctor pr-check [directory] [options]`

Analyze a branch diff for PR or CI feedback. The command lists files changed between `--base` and `--head`, scans isolated git worktrees for both refs, builds a Markdown PR summary, and can post it to GitHub, GitLab, or Bitbucket. GitHub uses the `gh` CLI; GitLab and Bitbucket use their APIs and write a `svelte-doctor` commit status for required-check workflows.

| Option                                         | Description                                              |
| ---------------------------------------------- | -------------------------------------------------------- |
| `--pr <number>`                                | Pull request number for comment posting                  |
| `--base <branch>`                              | Base branch or ref (default: `main`)                     |
| `--head <branch>`                              | Head branch or ref (default: `HEAD`)                     |
| `--comment`                                    | Post a summary comment to the selected PR platform       |
| `--inline`                                     | Submit an inline review comment to the selected platform |
| `--fail-on <never\|error\|warning>`            | Control exit behavior for new issues                     |
| `--min-score <score>`                          | Fail if PR score is below the threshold                  |
| `--json`                                       | Output machine-readable JSON                             |
| `--platform <github\|gitlab\|bitbucket\|auto>` | Select PR platform adapter mode                          |
| `--token <env-var>`                            | Token environment variable name                          |

Examples:

```bash
svelte-doctor pr-check --base main --head HEAD
svelte-doctor pr-check --base origin/main --head HEAD --min-score 80
svelte-doctor pr-check --pr 42 --comment --platform github
svelte-doctor pr-check --json
```

#### `svelte-doctor doctor [directory] [options]`

Check your development environment for common issues — inspired by `flutter doctor`. Diagnoses Node.js version, Svelte dependency presence, `svelte.config.js` configuration, `tsconfig.json` validity, `node_modules` installation state, `svelte-doctor.config.json` schema validation, `.gitignore` completeness, build artifact freshness, and scan cache status.

With `--fix`, the command automatically resolves missing or misconfigured project files: creates `svelte.config.js` with `vitePreprocess`, generates `tsconfig.json` with TypeScript configuration, bootstraps `svelte-doctor.config.json`, adds the `.svelte-doctor/*` entry to `.gitignore`, injects `doctor` and `doctor:fix` scripts into `package.json`, and runs the detected package manager to install `node_modules` when missing.

Each check returns one of four statuses: **pass**, **warning**, **fail**, or **na** (not applicable). The command exits with code 1 if any check fails, making it suitable for CI onboarding gates.

| Option   | Description                                                         |
| -------- | ------------------------------------------------------------------- |
| `--json` | Output machine-readable JSON                                        |
| `--fix`  | Automatically fix detected issues (config, gitignore, scripts, etc) |

Examples:

```bash
svelte-doctor doctor
svelte-doctor doctor packages/app
svelte-doctor doctor --json
svelte-doctor doctor --fix
```

#### `svelte-doctor reset [directory] [options]`

Clean generated files (cache, baseline, score history) inside `.svelte-doctor/`. Useful when cache gets corrupted, baseline becomes stale, or you want to start fresh without manually deleting files.

By default (no flags), all generated files are removed and the `.svelte-doctor/` directory is cleaned up if empty afterwards.

| Option       | Description                                                |
| ------------ | ---------------------------------------------------------- |
| `--all`      | Clean everything in `.svelte-doctor/` (default if no flag) |
| `--cache`    | Clean only scan cache                                      |
| `--baseline` | Clean only baseline                                        |
| `--history`  | Clean only score history                                   |
| `--dry-run`  | Show what would be deleted without deleting                |
| `--json`     | Output machine-readable JSON                               |

Examples:

```bash
svelte-doctor reset
svelte-doctor reset --dry-run
svelte-doctor reset --cache
svelte-doctor reset --baseline --history
svelte-doctor reset --all --json
```

### Scanning & Reporting

#### `svelte-doctor check [directory] [options]`

Scan your project for issues and output a health score. The scanner analyzes source files, Svelte compiler output, and existing SvelteKit build artifacts under `.svelte-kit/output/` when that directory exists. Every run saves the score to `.svelte-doctor/history.json`, including `--json` and `--score` modes, so your CI pipeline contributes to the trend graph. When `svelte-doctor` first creates its local `.svelte-doctor/` directory, it also ensures the scanned project's `.gitignore` contains a `.svelte-doctor/*` entry unless an equivalent `.svelte-doctor` or `.svelte-doctor/*` pattern already exists.

| Option                                    | Description                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `--score`                                 | Output only the numeric score                                                        |
| `--json`                                  | Output machine-readable JSON                                                         |
| `--no-lint`                               | Skip lint rules                                                                      |
| `--no-dead-code`                          | Skip dead code detection                                                             |
| `--no-cache`                              | Disable the on-disk scan cache for this run                                          |
| `--copy`                                  | Export diagnostics in an AI-friendly format                                          |
| `--copy-output <clipboard\|stdout\|file>` | Choose clipboard, stdout, or file output                                             |
| `--copy-file <path>`                      | Write export output to a file inside the scanned project root                        |
| `--copy-max <count>`                      | Limit how many diagnostics are included in the export                                |
| `--copy-errors-only`                      | Export only error-level diagnostics                                                  |
| `--copy-format <prompt\|raw>`             | Export as a structured prompt or raw text                                            |
| `--baseline`                              | Suppress diagnostics present in `.svelte-doctor/baseline.json`                       |
| `--sarif`                                 | Emit SARIF output                                                                    |
| `--sarif-file <path>`                     | Write SARIF output to a file                                                         |
| `--html`                                  | Write an interactive HTML report to `.svelte-doctor/report.html`                     |
| `--html-file <path>`                      | Write HTML report to a custom file                                                   |
| `--junit`                                 | Write a JUnit XML report to `.svelte-doctor/junit.xml`                               |
| `--junit-file <path>`                     | Write JUnit XML report to a custom file                                              |
| `--markdown`                              | Write a Markdown report to `.svelte-doctor/report.md`                                |
| `--markdown-file <path>`                  | Write Markdown report to a custom file                                               |
| `--github-annotations`                    | Emit GitHub Actions annotation commands                                              |
| `--fail-on <never\|error\|warning>`       | Control exit behavior                                                                |
| `--min-score <score>`                     | Fail if score is below the threshold                                                 |
| `--changed`                               | Scan files changed relative to `HEAD`                                                |
| `--staged`                                | Scan staged files only                                                               |
| `--since <ref>`                           | Scan files changed since a git ref                                                   |
| `--all-workspaces`                        | Scan all package.json workspaces                                                     |
| `--workspace <name>`                      | Scan one workspace by name or relative path                                          |
| `--fix`                                   | Apply deterministic auto-fixes after scan                                            |
| `--diff`                                  | With `--fix`: preview automatic fixes as unified diffs                               |
| `--interactive`                           | With `--fix`: confirm each fix individually (`y`, `n`, `a`, `q`)                     |
| `--fix-ai`                                | Also run AI agent fix after deterministic fixes                                      |
| `--dry-run`                               | With `--fix`: preview fixes without writing files                                    |
| `--rules <csv>`                           | With `--fix`: limit deterministic fixes to comma-separated rules                     |
| `--errors-only`                           | With `--fix`: fix only error-severity diagnostics                                    |
| `--verify-level <level>`                  | With `--fix-ai`: verification depth — `diagnostics`, `typecheck`, `tests`, or `full` |
| `--max-files <count>`                     | With `--fix-ai`: max diagnostics in AI agent batch (default: 50)                     |
| `--jobs <count>`                          | Number of parallel scan workers (0 = auto-detect CPU count, default: 1)              |

`--copy` is designed for cases where you want to paste diagnostics into a different AI agent instead of using `svelte-doctor fix`. The default mode tries the system clipboard first, then falls back to stdout if no clipboard integration is available. If you need deterministic output for scripts, use `--copy-output file`.

JSON output includes structured fix metrics:

| Field              | Type     | Description                                          |
| ------------------ | -------- | ---------------------------------------------------- |
| `fixableSummary`   | object   | Auto-fixable, AI-fixable, and manual-required counts |
| `estimatedFixTime` | string   | Estimated time to fix all issues (e.g. `"3m 20s"`)   |
| `priorityFiles`    | string[] | Top 5 files ranked by weighted issue severity        |
| `regressionRisk`   | string   | `low`, `medium`, `high`, or `critical` risk level    |

```bash
# Quick CI summary with jq
svelte-doctor check --json | jq '{score, risk: .regressionRisk, fixTime: .estimatedFixTime, autoFix: .fixableSummary.autoFixable}'

# Gate PRs by regression risk
RISK=$(svelte-doctor check --json | jq -r '.regressionRisk')
if [ "$RISK" = "high" ] || [ "$RISK" = "critical" ]; then
  echo "Block merge: regression risk too high"
  exit 1
fi
```

Rich reports also work with `--all-workspaces` and `--workspace`. Workspace reports aggregate diagnostics into one file and prefix paths with the workspace directory, such as `packages/app/src/App.svelte`.

Examples:

```bash
svelte-doctor check --copy
svelte-doctor check --copy --copy-errors-only
svelte-doctor check --copy --copy-output stdout
svelte-doctor check --copy --copy-output file --copy-file .svelte-doctor/diagnostics.txt
svelte-doctor check --changed
svelte-doctor check --fix --diff --dry-run
svelte-doctor check --sarif --sarif-file .svelte-doctor/report.sarif
svelte-doctor check --html --html-file .svelte-doctor/report.html
svelte-doctor check --junit --junit-file .svelte-doctor/junit.xml
svelte-doctor check --markdown --markdown-file .svelte-doctor/report.md
svelte-doctor check --all-workspaces --html --junit --markdown

# Parallel scanning for large codebases
svelte-doctor check --jobs 4
svelte-doctor check --jobs 0  # auto-detect CPU count

# Scan and apply fixes in one step
svelte-doctor check --fix
svelte-doctor check --fix --dry-run
svelte-doctor check --fix --interactive
svelte-doctor check --fix --fix-ai --verify-level tests
```

#### `svelte-doctor quick [directory] [options]`

Fast error-only scan with health score. Runs a lint scan with cache enabled and dead-code detection disabled for maximum speed. Only error-level diagnostics are reported, making it ideal for quick pre-commit checks or rapid feedback during development.

| Option    | Description                   |
| --------- | ----------------------------- |
| `--json`  | Output machine-readable JSON  |
| `--score` | Output only the numeric score |

Examples:

```bash
svelte-doctor quick
svelte-doctor quick --score
svelte-doctor quick packages/app --json
```

#### `svelte-doctor audit [directory] [options]`

Security-focused scan that runs the full lint pipeline but filters results to only the Security category. Computes a dedicated security score from the filtered diagnostics. Useful for compliance checks, security reviews, and CI gates that focus exclusively on security posture.

| Option    | Description                    |
| --------- | ------------------------------ |
| `--json`  | Output machine-readable JSON   |
| `--score` | Output only the security score |

Security rules include XSS via `{@html}`, hardcoded secrets, `eval()` usage, insecure cookies, broad CORS, shell injection, server secret leaks, dangerous redirect parameters, public env secret imports, external links without `rel="noopener"`, and raw error details exposed to clients.

Examples:

```bash
svelte-doctor audit
svelte-doctor audit --score
svelte-doctor audit --json
svelte-doctor audit packages/api --json
```

#### `svelte-doctor baseline [directory]`

Create `.svelte-doctor/baseline.json` from the current diagnostics so future checks can suppress already-known issues with `check --baseline`.

Examples:

```bash
svelte-doctor baseline
svelte-doctor baseline --changed
svelte-doctor baseline --all-workspaces
```

#### `svelte-doctor config [directory] [options]`

Display the active `svelte-doctor` configuration. Reads from `svelte-doctor.config.json` first, then falls back to the `"svelte-doctor"` key in `package.json`. Shows all active settings including lint, dead-code, cache, watch, fix, reports, and ignore rules.

| Option   | Description                    |
| -------- | ------------------------------ |
| `--json` | Output machine-readable JSON   |
| `--path` | Show only the config file path |

Examples:

```bash
svelte-doctor config
svelte-doctor config --json
svelte-doctor config --path
```

#### `svelte-doctor validate [directory] [options]`

Validate the `svelte-doctor.config.json` file for syntax and schema errors. Checks for invalid JSON syntax, unknown top-level and nested keys, type mismatches (e.g., string where boolean expected), invalid enum values (e.g., `watch.deadCode`, `fix.verifyLevel`), empty report paths, and malformed ignore lists with non-string elements.

| Option   | Description                  |
| -------- | ---------------------------- |
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

#### `svelte-doctor suggest-ignore [directory] [options]`

Generate smart ignore suggestions for diagnostics that are likely false positives or low-risk noise. Each suggestion includes a confidence score, the reason it was flagged, and an ignore config snippet you can review before copying into `svelte-doctor.config.json`.

This is intentionally advisory. It does not write config automatically.

| Option   | Description                                              |
| -------- | -------------------------------------------------------- |
| `--json` | Output machine-readable JSON with suggestions and config |

Examples:

```bash
svelte-doctor suggest-ignore
svelte-doctor suggest-ignore --json
```

#### `svelte-doctor stats [directory] [options]`

Show project metrics including total diagnostics by severity, category breakdown with error/warning counts and penalty weights, most frequently triggered rules, and most affected files. Useful for identifying systemic patterns and prioritizing cleanup efforts.

| Option          | Description                                          |
| --------------- | ---------------------------------------------------- |
| `--json`        | Output machine-readable JSON                         |
| `--top <count>` | Number of top items to show per list (default: `10`) |

Examples:

```bash
svelte-doctor stats
svelte-doctor stats --top 5
svelte-doctor stats --json
svelte-doctor stats --top 3 --json
```

#### `svelte-doctor compare [directory] [options]`

Compare diagnostics between two git refs (commits, branches, tags). Creates temporary git worktrees for both refs, runs independent scans, and reports the score delta along with newly introduced and fixed diagnostics. The comparison is symmetric: it shows both what got worse and what improved.

| Option         | Description                                          |
| -------------- | ---------------------------------------------------- |
| `--base <ref>` | Base git ref (commit, branch, tag) (default: `main`) |
| `--head <ref>` | Head git ref (default: `HEAD`)                       |
| `--json`       | Output machine-readable JSON                         |

Git refs are validated for injection-safe characters. Temporary worktrees are created in the OS temp directory and cleaned up automatically, even on scan failure.

Examples:

```bash
svelte-doctor compare --base main --head HEAD
svelte-doctor compare --base v1.0.0 --head v2.0.0
svelte-doctor compare --base HEAD~5 --head HEAD --json
svelte-doctor compare --base origin/main --head feature/xyz
```

#### `svelte-doctor watch [directory] [options]`

Watch for file changes and show live diagnostics. Runs an initial cached scan, then incrementally re-scans only changed files with 150ms debounced updates. With `--fix`, deterministic fixes are applied automatically when a file is saved — the watch loop closes the feedback gap between "see the issue" and "fix the issue".

| Option               | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `--dead-code <mode>` | Dead-code behavior in watch mode: `off`, `lazy`, or `full`                |
| `--fix`              | Auto-apply deterministic fixes to saved files                             |
| `--fix-rules <csv>`  | With `--fix`: limit auto-fixes to comma-separated rules (implies `--fix`) |

Auto-fix can also be enabled permanently in `svelte-doctor.config.json` — no CLI flag needed:

```jsonc
{
  "watch": {
    "deadCode": "lazy",
    "fix": true, // or { "rules": ["no-transition-all", "no-moment"] }
  },
}
```

CLI flags (`--fix`, `--fix-rules`) take precedence over config. Only deterministic, high-confidence fixes are applied — the same set as `svelte-doctor apply` — so the loop stays safe. When a fix is applied, the line shows which rules were fixed:

```text
[12:34:56] src/Component.svelte changed — Score: 82 → 78 (⚠ 2 issues)
[12:34:59] src/Layout.svelte changed — Score: 78 → 80 (✓ fixed: no-transition-all)
[12:35:02] src/Card.svelte changed — Score: 80 → 84 (✓ score improved +4)
```

#### `svelte-doctor trend [directory] [options]`

Show score history and trend over time. Every `check` run automatically saves the score to `.svelte-doctor/history.json`. The `trend` command visualizes this data as a terminal bar chart.

Monorepos can also query the latest trend snapshot per workspace with `--all-workspaces` or `--workspace <name>`.

### Fixing & Migration

#### `svelte-doctor apply [directory] [options]`

Apply deterministic, high-confidence fixes without launching an AI agent. This command is intentionally conservative and only rewrites patterns the tool can fix safely.

**Supported fixes:**

- `no-transition-all` — replaces `transition: all` with explicit `opacity` and `transform`
- `no-full-lodash` — rewrites full lodash imports to per-function paths
- `no-moment` — replaces `moment` imports with `dayjs`
- `no-full-icon-import` — converts namespace icon imports to named imports
- Svelte 4→5 migration rules (`no-legacy-reactive`, `no-export-let`, `no-legacy-slots`, `no-on-directive`, `no-event-dispatcher`, `no-let-directive`, `no-legacy-lifecycle`)
- `no-unnecessary-state` — strips `$state()` wrapper from values that are never mutated
- `no-effect-for-derived` — converts `$effect(() => { x = expr })` to `const x = $derived(expr)`

| Option          | Description                                          |
| --------------- | ---------------------------------------------------- |
| `--dry-run`     | Preview changes without writing files                |
| `--write`       | Write changes to disk                                |
| `--json`        | Output machine-readable JSON                         |
| `--rules <csv>` | Restrict fixes to specific rule names                |
| `--changed`     | Apply fixes only on files changed relative to `HEAD` |
| `--staged`      | Apply fixes only on staged files                     |
| `--since <ref>` | Apply fixes only on files changed since a git ref    |

Examples:

```bash
svelte-doctor apply --write
svelte-doctor apply --dry-run
svelte-doctor apply --write --rules no-transition-all,no-full-lodash
```

#### `svelte-doctor fix [directory] [options]`

Detects installed AI coding agents (**Cursor**, **Amp**, **Claude Code**, **Codex**, **Copilot CLI**, **OpenCode**, **Pi**, **Gemini CLI**, **Qwen Code**, **Aider**, **Goose**) and uses the best available one to fix reported issues automatically. The flow is **safe by default**: privileged agent flags are disabled unless you explicitly pass `--unsafe-agent-exec`. Diagnostics are redacted before prompt generation, prompts are written into a secure temp directory when needed, and post-fix verification can be escalated from diagnostics-only to full typecheck/test/build smoke.

Supported agent ids for `--agent` are `cursor`, `amp`, `claude`, `codex`, `copilot`, `opencode`, `pi`, `gemini`, `qwen`, `aider`, and `goose`. Install and authenticate at least one of them first, then run `svelte-doctor fix`. The command uses each agent's documented non-interactive mode where available: Amp execute mode, Claude print mode, Codex exec mode, Copilot prompt mode, OpenCode run mode, Pi print mode, Gemini headless mode, Qwen headless mode, Aider message mode, and Goose run mode.

| Option                   | Description                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `--agent <name>`         | Force a specific agent (cursor, amp, claude, codex, copilot, opencode, pi, gemini, qwen, aider, goose) |
| `--errors-only`          | Fix only errors first (reduces cascade errors, run again for warnings)                                 |
| `--unsafe-agent-exec`    | Opt in to agent-specific privileged execution flags                                                    |
| `--dry-run-prompt`       | Generate the secure prompt bundle without spawning an agent                                            |
| `--verify-level <level>` | Verification depth: `diagnostics`, `typecheck`, `tests`, `full`                                        |
| `--max-files <count>`    | Limit how many diagnostics are sent in a single agent batch                                            |

Supported agents under `src/agents`:

| Agent id   | CLI command | Non-interactive mode                                           |
| ---------- | ----------- | -------------------------------------------------------------- |
| `cursor`   | `agent`     | `--print --workspace <cwd> --output-format stream-json`        |
| `amp`      | `amp`       | `-x` execute mode, unsafe opt-in via `--dangerously-allow-all` |
| `claude`   | `claude`    | `-p --output-format stream-json --include-partial-messages`    |
| `codex`    | `codex`     | `exec -C <cwd>`, unsafe opt-in via bypass flag                 |
| `copilot`  | `copilot`   | `-p`                                                           |
| `opencode` | `opencode`  | `run`                                                          |
| `pi`       | `pi`        | `-p`                                                           |
| `gemini`   | `gemini`    | `-p`, unsafe opt-in via `--yolo`                               |
| `qwen`     | `qwen`      | `-p`, unsafe opt-in via `--yolo`                               |
| `aider`    | `aider`     | `--yes --no-auto-commits --message`                            |
| `goose`    | `goose`     | `run --no-session --quiet -t`                                  |

Examples:

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

#### `svelte-doctor migrate [directory] [options]`

Auto-migrate Svelte 4 syntax to Svelte 5. The migration engine uses a modular codemod pipeline with Svelte parser validation and TypeScript AST-backed script transforms for safer rewrites than line-only regex replacement. Template transforms remain conservative and parser-validated; complex cases are marked for review instead of being silently rewritten. Both `.svelte` component files and `.svelte.js` / `.svelte.ts` module files are scanned and migrated — module files receive reactive-statement, lifecycle, and store transforms since they can contain `$:` reactive statements and lifecycle imports that need runes migration.

**Transformations:**

- `$:` reactive statements → `$derived()` / `$effect()`
- `export let` props, including defaults and TypeScript annotations → `let { ... } = $props()`
- Destructuring reactive assignments such as `$: ({ value } = item)` → `$derived()` review-safe output
- `createEventDispatcher` → callback props review marker
- `<slot>` and named slots → `{@render children?.()}` / `{@render name?.()}`
- `on:click={handler}` → `onclick={handler}`
- `let:` directives → snippet-prop review markers
- `onMount` / `onDestroy` → `$effect()` review marker
- `beforeUpdate` / `afterUpdate` → `$effect.pre()` review marker
- `svelte/store` `writable` / `derived` usage → manual-review warning for shared stores and subscriptions
- `class:active={isActive}` → `class={isActive ? "active" : ""}`
- `export const` in instance scripts → `<script module>` exports
- `<svelte:options immutable/accessors>` → modern API review marker

| Option            | Description                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`       | Show changes without modifying files                                                                                                                                                                          |
| `--diff`          | Output unified diff for proposed changes                                                                                                                                                                      |
| `--interactive`   | Show each file diff and ask before applying (`y`, `n`, `a`, `q`)                                                                                                                                              |
| `--plan`          | Report total files, auto-migratable files, manual-review files, and top issue categories without writing files                                                                                                |
| `--commit-stages` | Run supported migration stages and create one git commit per stage                                                                                                                                            |
| `--rollback`      | Restore files from `.bak` backups and remove the backup files                                                                                                                                                 |
| `--no-backup`     | Skip creating `.bak` backup files                                                                                                                                                                             |
| `--stage <name>`  | Run only one stage: `reactive-statement`, `export-let`, `event-dispatcher`, `slot`, `on-directive`, `lifecycle`, `let-directive`, `store`, `class-directive`, `module-export`, `snippet`, or `svelte-options` |
| `--json`          | Output machine-readable JSON                                                                                                                                                                                  |

Examples:

```bash
# Preview all changes as a patch without writing files
svelte-doctor migrate --dry-run --diff > migration.patch

# Get a migration plan for CI or rollout estimation
svelte-doctor migrate --plan
svelte-doctor migrate --plan --json

# Review and accept each file interactively
svelte-doctor migrate --interactive

# Apply only one stage
svelte-doctor migrate --stage export-let

# Restore from backups created by the default migration mode
svelte-doctor migrate --rollback
```

#### `svelte-doctor migrate-status [directory] [options]`

Show Svelte 4 to 5 migration progress without modifying files. The command scans `.svelte` files for pending legacy patterns and reports migrated, pending, and skipped file counts, category-specific progress, and an estimated remaining time.

Tracked categories:

- reactive statements (`$:`)
- `export let` props
- legacy `<slot>` usage
- `on:event` directives

| Option   | Description                  |
| -------- | ---------------------------- |
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor migrate-status
svelte-doctor migrate-status --json
```

### Analysis & Insights

#### `svelte-doctor graph [directory] [options]`

Build a component dependency graph from local imports and rendered component tags. The graph helps answer which component imports or renders another component and highlights circular dependencies. Imports through SvelteKit's `$lib` alias and custom `tsconfig.json` `compilerOptions.paths` aliases are resolved, alongside relative and re-export specifiers.

| Option                        | Description                        |
| ----------------------------- | ---------------------------------- |
| `--format <ascii\|dot\|json>` | Output format, defaults to `ascii` |

Examples:

```bash
svelte-doctor graph
svelte-doctor graph --format dot > graph.dot
svelte-doctor graph --format json
```

#### `svelte-doctor where-used <component> [directory] [options]`

Find every place a component is imported or rendered, with line-accurate locations and source snippets. Useful for impact analysis before refactoring or removing a component.

The `<component>` argument accepts a component name (`Button`) or a full project-relative path (`src/lib/Button.svelte`). Multiple components can be passed comma-separated (`Button,Card,Modal`).

| Option                        | Description                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `--json`                      | Output machine-readable JSON                                                      |
| `--type <import\|render>`     | Restrict to import or render usages                                               |
| `--scope <path>`              | Restrict results to files under a subdirectory                                    |
| `--direction <used-by\|uses>` | `used-by` (default) finds who uses the component; `uses` finds what it depends on |
| `--tree`                      | Render the parent render hierarchy as an ASCII tree rooted at entry points        |

Ambiguous component names (for example `src/lib/Button.svelte` and `src/ui/Button.svelte`) produce an error listing the candidates so you can disambiguate with the full path. Re-exports (`export { default as Button } from ...`) and string-literal dynamic imports (`await import("...")`) are reported as import usages. Imports through SvelteKit's `$lib` alias (default `$lib` -> `src/lib`) and custom `tsconfig.json` `compilerOptions.paths` aliases (`$components/*`, `@/*`, etc.) are resolved automatically, so SvelteKit projects report import usages the same way relative imports do.

Examples:

```bash
# who uses Button?
svelte-doctor where-used Button

# full path query
svelte-doctor where-used src/lib/Button.svelte

# CI / automation output
svelte-doctor where-used Button --json

# multiple components
svelte-doctor where-used Button,Card,Modal

# only render sites
svelte-doctor where-used Button --type render

# render tree of parents leading to Button
svelte-doctor where-used Button --tree

# scope to a subdirectory
svelte-doctor where-used Button --scope src/pages

# reverse: what does Button depend on?
svelte-doctor where-used Button --direction uses
```

#### `svelte-doctor dead-stores [directory] [options]`

Detect `writable` stores that are never written to anywhere in the project. A `writable` that is only ever read should be a `readable` store or migrated to Svelte 5 runes `$state`. This is especially useful when migrating a codebase from stores to runes: it identifies stores that can be safely converted to read-only values without changing any write sites.

The analysis is cross-file: it tracks `.set()`, `.update()`, `this.store.set()` in classes, and `$store =` auto-subscription writes in `.svelte` templates, resolving imports and re-exports back to the original declaration. Stores that are written in any file are reported as OK with their write sites listed.

| Option   | Description                  |
| -------- | ---------------------------- |
| `--json` | Output machine-readable JSON |

Examples:

```bash
# full dead store report
svelte-doctor dead-stores

# CI / automation output
svelte-doctor dead-stores --json

# scan a specific workspace
svelte-doctor dead-stores packages/app
```

Sample text output:

```text
  Dead store report: 1 never-written, 1 ok, 2 total

  Never written (candidates for readable or $state):

  user - writable - NEVER WRITTEN (src/stores/user.ts:2)
  Used in ($-auto-subscribe, 1):
    src/routes/+page.svelte:7           $currentUser
  Replace with: replace `user` with a `readable` store (read-only contract) or migrate to runes `$state` and expose via props

  Written (OK):

  counter - writable - WRITTEN (src/stores/counter.ts:2)
  Written in 2 places:
    src/routes/+page.svelte:5           $counter =
    src/stores/counter.ts:3             counter.set()
```

#### `svelte-doctor test-gaps [directory] [options]`

Find source files that do not have a nearby matching test file. It also marks critical SvelteKit paths, such as server load modules and form actions, so CI can prioritize missing tests for production-sensitive code.

| Option   | Description                  |
| -------- | ---------------------------- |
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor test-gaps
svelte-doctor test-gaps --json
```

#### `svelte-doctor bundle-impact [directory] [options]`

Estimate potential bundle savings from fixable bundle-size diagnostics. Current estimates cover heavy imports such as `moment`, full `lodash`, and wildcard icon package imports.

| Option   | Description                  |
| -------- | ---------------------------- |
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor bundle-impact
svelte-doctor bundle-impact --json
```

#### `svelte-doctor render-profile [directory] [options]`

Analyze Svelte components before runtime and rank the most expensive render surfaces. The profiler parses and compiles each `.svelte` file, then combines AST and compiled-output signals into a deterministic render cost model.

Per component metrics:

- DOM node count
- reactive dependency count
- hydration complexity score
- re-render risk factor
- compiled output size
- aggregate render cost

The default terminal output lists the top 10 most expensive components. `--watch` re-runs the profile when `.svelte` files change and shows cost deltas, which helps catch render-cost regressions before a build reaches production.

| Option          | Description                                            |
| --------------- | ------------------------------------------------------ |
| `--json`        | Output machine-readable JSON                           |
| `--top <count>` | Number of expensive components to show, defaults to 10 |
| `--watch`       | Watch `.svelte` files and show render cost changes     |

Examples:

```bash
svelte-doctor render-profile
svelte-doctor render-profile --top 5
svelte-doctor render-profile --watch
svelte-doctor render-profile --json
```

### Dependencies & Updates

#### `svelte-doctor deps [directory] [options]`

Check dependency health for Svelte ecosystem compatibility. Fully offline — no network requests.

**Checks:**

- **Deprecated packages** — sapper, svelte-routing, svelte-preprocess, etc.
- **Svelte 5 compatibility** — packages not updated for runes/snippets
- **Risky version ranges** — `*` or `latest` dependencies
- **Better alternatives** — axios → fetch, moment → dayjs, lodash → lodash-es

| Option   | Description                  |
| -------- | ---------------------------- |
| `--json` | Output machine-readable JSON |

#### `svelte-doctor upgrade [directory] [options]`

Check project dependencies against the npm registry and prepare safe upgrade suggestions. By default, major upgrades are excluded. Use `--dry-run` to report without touching `package.json`; without `--dry-run`, accepted suggestions are written atomically and the detected package manager runs install.

The upgrade plan includes current version, lockfile-resolved version when available, latest version, wanted range, dependency block, major/minor/patch classification, deprecation signal, replacement alternative when known, breaking-change flag, changelog/repository URL when available, and risk score.

| Option               | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `--dry-run`          | Report upgrades without writing `package.json` or lockfile    |
| `--interactive`      | Ask before applying each package upgrade (`y`, `n`, `a`, `q`) |
| `--major`            | Include major-version upgrades                                |
| `--json`             | Output machine-readable JSON                                  |
| `--all-workspaces`   | Check every package.json workspace                            |
| `--workspace <name>` | Check one workspace by name or relative path                  |

Examples:

```bash
svelte-doctor upgrade --dry-run
svelte-doctor upgrade --dry-run --major
svelte-doctor upgrade --json
svelte-doctor upgrade --all-workspaces --dry-run
```

#### `svelte-doctor update [options]`

Checks the official npm registry for the latest `svelte-doctor` version and updates the **global CLI installation**. This command does not update local project dependencies.

| Option                       | Description                                         |
| ---------------------------- | --------------------------------------------------- |
| `--check`                    | Check for an update without installing              |
| `--dry-run`                  | Print the global install command without running it |
| `--manager <npm\|pnpm\|bun>` | Override package manager detection                  |
| `--tag <latest>`             | Release tag to install (`latest` only)              |
| `--json`                     | Output machine-readable JSON                        |

### Rules & Plugins

#### `svelte-doctor rules [directory]`

List every rule with its category and whether it supports deterministic autofix. Rules are grouped by source (built-in, plugin, or local), so custom rules appear alongside the built-ins.

#### `svelte-doctor explain <rule> [directory] [options]`

Explain what a rule checks, why it matters, and what the safest remediation looks like. With `--fix`, shows before/after code examples and scans the project for occurrences that would be fixed — use it as a learning and discovery tool before running `apply --write` on the entire codebase.

Rules with deterministic fixes show an interactive apply prompt after listing occurrences. AI-only rules (like `no-giant-component` or `too-many-effects`) show examples but do not offer automatic apply since they require manual judgment.

| Option   | Description                                                           |
| -------- | --------------------------------------------------------------------- |
| `--fix`  | Show fix examples and scan project for matching occurrences           |
| `--json` | Output machine-readable JSON (combine with `--fix` for full fix data) |

Examples:

```bash
# Basic rule explanation
svelte-doctor explain no-transition-all

# Explain with fix examples and scan
svelte-doctor explain no-transition-all --fix

# Machine-readable output with occurrence data
svelte-doctor explain no-moment --fix --json

# Scan a specific workspace
svelte-doctor explain no-full-lodash packages/app --fix
```

#### `svelte-doctor create-rule <name> [directory] [options]`

Scaffold a custom rule package with a rule template, test template, and docs template. Rule names must be kebab-case, for example `no-custom-pattern`. Existing files are never overwritten.

Generated files:

- `src/rules/custom/<name>/index.ts`
- `src/rules/custom/<name>/README.md`
- `test/<name>.test.mjs`

| Option   | Description                  |
| -------- | ---------------------------- |
| `--json` | Output machine-readable JSON |

Examples:

```bash
svelte-doctor create-rule no-custom-pattern
svelte-doctor create-rule no-custom-pattern --json
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

## Plugins & Community Rules

`svelte-doctor` is extensible. Beyond the built-in rules you can add **custom rules** and **community plugins** without forking the CLI. Every custom rule plugs into the same engine: it is linted, scored, cached, ignored, and fixed (when it exposes a `fix`) exactly like a built-in rule, and its origin is recorded on every diagnostic.

> Full authoring guide, API reference, and the security model are in
> [`docs/plugins.md`](docs/plugins.md). Read the security section before adopting third-party
> plugins in CI.

### Security Model (summary)

- **npm plugins are not auto-executed.** A `svelte-doctor-plugin-*` dependency is only loaded
  when you list it under `plugins.include` (or opt into `plugins.autoDiscoverNpm`, which is off
  by default). This prevents a compromised or typosquatted dependency from running code during
  your scan.
- **Local rules are trusted.** Files under `svelte-doctor.rules/` are auto-loaded (same trust
  boundary as your source) but are validated and confined to the project root.
- **Kill-switch:** set `SD_DISABLE_PLUGINS=1` (or `plugins: false`) for built-in rules only.
- **Isolation:** a plugin that throws during `check`/`fix` becomes a warning and never aborts
  the run.
- **Namespacing:** each custom rule gets a stable id `<namespace>/<rule>` (e.g.
  `svelte-doctor-plugin-a11y-plus/no-broken-anchor`), so plugins can never silently collide and
  every diagnostic records its exact origin.

### Authoring a Local Rule

The fastest path is `create-rule`, which scaffolds a runtime-loadable rule under
`svelte-doctor.rules/`. The folder is auto-discovered on every scan, so no wiring is required.

```bash
svelte-doctor create-rule no-custom-pattern
```

Generated file (`svelte-doctor.rules/no-custom-pattern.mjs`):

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
  check: (ctx) => {
    const diagnostics = [];
    // ctx exposes filePath, source, lines, ast, scriptBlocks, projectInfo
    return diagnostics;
  },
  // optional: fix: (source, diagnostic) => string
};
```

A rule receives a `RuleContext` and returns `Diagnostic[]`. Supported export shapes: a single
default-exported `Rule`, a default-exported plugin object `{ name, rules }`, a named
`svelteDoctorPlugin` export, or a default-exported array of `Rule`. The package exports
`defineRule`, `definePlugin`, and `validateRule` helpers for author-time validation.

### Configuration

```jsonc
// svelte-doctor.config.json
{
  "plugins": {
    "enabled": true,
    "include": ["svelte-doctor-plugin-a11y-plus", "@my-org/svelte-doctor-plugin-internal"],
    "exclude": ["legacy-plugin"],
    "autoDiscoverNpm": false,
    "local": ["svelte-doctor.rules/**/*.{mjs,js,cjs}"],
  },
}
```

- `enabled` — set `false` to disable all plugins/local rules
- `include` — npm plugin package names to load (the recommended, auditable way to adopt plugins)
- `exclude` — package names to disable entirely
- `autoDiscoverNpm` — when `true`, every `svelte-doctor-plugin-*` dependency is executed (off by default)
- `local` — globs for runtime-loadable local rule files (default: `svelte-doctor.rules/**/*.{mjs,js,cjs}`)

Rule ids are namespaced, so two plugins can never collide. Malformed plugin rules are reported
as warnings and never crash a scan.

### Browsing the Catalog

`svelte-doctor` ships a central, offline catalog of community plugins. It is contributable:
open a pull request to add an entry.

```bash
svelte-doctor registry list
svelte-doctor registry search a11y
svelte-doctor registry info a11y-plus
svelte-doctor registry add a11y-plus        # installs via your package manager (does not auto-enable)
svelte-doctor registry add a11y-plus --dry-run
```

### Inspecting What Is Loaded

```bash
svelte-doctor plugins            # plugins + local rule folders, with source/version/entry paths
svelte-doctor plugins --json
svelte-doctor rules              # all rules, grouped by built-in / plugin / local
svelte-doctor explain <rule>     # shows the namespaced id and source plugin
```

---

## Rules

**82 source rules + 3 build artifact diagnostics**, grouped by category.

### Correctness (10)

Rules in this category only fire in **runes-mode projects** (projects that use `$state`, `$derived`, `$effect`, or `$props`). They flag Svelte 4 patterns that are broken or deprecated in Svelte 5.

| Rule                          | Severity | Description                                                        |
| ----------------------------- | -------- | ------------------------------------------------------------------ |
| `no-legacy-reactive`          | error    | `$:` reactive statements → `$derived` / `$effect` (fixable)        |
| `no-legacy-lifecycle`         | error    | `onMount`/`onDestroy` imports → `$effect` (fixable)                |
| `no-export-let`               | error    | `export let` → `$props()` (fixable)                                |
| `no-event-dispatcher`         | error    | `createEventDispatcher` → callback props (fixable)                 |
| `no-legacy-slots`             | error    | `<slot>` → `{@render children()}` (fixable)                        |
| `no-let-directive`            | error    | `let:` directive → snippet props (fixable)                         |
| `no-on-directive`             | warning  | `on:event` → `onevent` attributes (fixable)                        |
| `no-$inspect-in-production`   | error    | `$inspect()` debug rune should not reach production                |
| `no-$state-frozen-misuse`     | warning  | `.push()` or `.splice()` on `$state.frozen()` objects              |
| `no-class-instance-as-$state` | warning  | Class instance passed to `$state()` breaks fine-grained reactivity |

### Performance (21)

| Rule                                    | Severity | Description                                                                    |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `no-effect-for-derived`                 | warning  | `$effect` used where `$derived` fits (fixable)                                 |
| `each-missing-key`                      | warning  | `{#each}` without key expression                                               |
| `no-inline-object`                      | warning  | Inline objects/arrays in template expressions                                  |
| `no-transition-all`                     | warning  | `transition: all` is expensive (fixable)                                       |
| `no-large-inline-list-transform`        | warning  | Expensive `.filter().map().sort()` chains in template markup                   |
| `no-repeated-derived-allocation`        | warning  | Repeated allocations inside `$derived()`                                       |
| `no-blocking-sync-fs-in-hot-cli-path`   | warning  | Sync fs calls in hot scan paths                                                |
| `prefer-lazy-deadcode-phase`            | warning  | Full dead-code scans configured in fast feedback paths                         |
| `too-many-effects`                      | warning  | Compiler output contains many reactive effects in one component                |
| `effect-without-cleanup`                | warning  | `$effect` registers listeners, timers, or subscriptions without cleanup        |
| `derived-with-side-effect`              | warning  | `$derived` contains DOM, storage, timer, or network side effects               |
| `deep-template-tree`                    | warning  | Compiled template is deeply nested and may mount/hydrate slowly                |
| `no-hydration-mismatch-template-values` | warning  | Template uses browser-only, random, or time-based values that can mismatch SSR |
| `no-inline-event-handler`               | warning  | Inline event handler creates a new function reference                          |
| `no-expensive-derived`                  | warning  | `$derived` performs heavy parsing, sorting, regex, or repeated filtering       |
| `no-high-specificity`                   | warning  | CSS selector specificity is too high                                           |
| `no-deep-css-nesting`                   | warning  | CSS selector nesting is too deep                                               |
| `no-id-selector`                        | warning  | ID selector creates high specificity in component styles                       |
| `no-important-override`                 | warning  | CSS uses `!important` override                                                 |
| `no-style-tag-props`                    | warning  | Inline style attribute can conflict with CSP and maintainability               |
| `prefer-snippet-over-passed-function`   | warning  | Function prop where `{#snippet}` + `{@render}` should be used                  |

### Architecture (4)

| Rule                 | Severity | Description                                  |
| -------------------- | -------- | -------------------------------------------- |
| `no-giant-component` | warning  | Component exceeds 300 lines                  |
| `no-deep-nesting`    | warning  | More than 3 levels of template block nesting |
| `no-console`         | warning  | `console.*` left in components               |
| `no-multi-script`    | warning  | Multiple instance `<script>` blocks          |

### Security (11)

| Rule                          | Severity | Description                                                |
| ----------------------------- | -------- | ---------------------------------------------------------- |
| `no-unsafe-html`              | error    | `{@html}` is an XSS vector                                 |
| `no-secrets`                  | error    | Hardcoded API keys / tokens                                |
| `no-eval`                     | error    | `eval()` usage                                             |
| `no-public-env-secrets`       | error    | Secrets imported from public `$env` modules                |
| `no-dangerous-redirect-param` | error    | Redirect target comes from untrusted query data            |
| `cookie-missing-secure-flags` | error    | `cookies.set()` missing `httpOnly` / `secure` / `sameSite` |
| `no-broad-cors`               | error    | Wildcard CORS or wildcard+credentials configuration        |
| `no-server-secret-leak`       | error    | Private env vars returned from server code                 |
| `no-unsafe-shell`             | error    | `exec`, `execSync`, or `spawn(..., { shell: true })`       |
| `no-plain-external-anchor`    | warning  | External `<a>` link missing `rel="noopener noreferrer"`    |
| `no-exposed-error-details`    | error    | Raw `error.message` or `error.stack` returned to client    |

### SvelteKit (10)

| Rule                              | Severity | Description                                                  |
| --------------------------------- | -------- | ------------------------------------------------------------ |
| `no-client-fetch`                 | warning  | `fetch` in component scripts → use `load` functions          |
| `load-missing-type`               | warning  | Load function without type annotation (TypeScript only)      |
| `no-goto-external`                | warning  | `goto()` with external URLs                                  |
| `form-action-no-validation`       | warning  | Form actions without input validation                        |
| `missing-error-page`              | warning  | No `+error.svelte` found                                     |
| `server-load-missing-error-guard` | warning  | Server load uses remote fetch without obvious error handling |
| `form-action-missing-auth-check`  | warning  | Form actions mutate without an obvious auth/session check    |
| `no-missing-prefetch`             | warning  | Navigation link missing `data-sveltekit-prefetch`            |
| `no-form-action-without-redirect` | warning  | POST form action missing `redirect()` after mutation         |
| `no-non-serializable-load-return` | error    | Server load returns non-serializable value (function, class) |

### Bundle Size (4 source rules + 3 build artifact diagnostics)

| Rule                         | Severity | Description                                               |
| ---------------------------- | -------- | --------------------------------------------------------- |
| `no-barrel-import`           | warning  | Barrel imports prevent tree-shaking                       |
| `no-full-lodash`             | warning  | Full `lodash` import (~70kb) (fixable)                    |
| `no-moment`                  | warning  | `moment.js` is heavy (~300kb) (fixable)                   |
| `no-full-icon-import`        | warning  | Wildcard icon imports prevent tree-shaking (fixable)      |
| `chunk-size-limit`           | warning  | Build output chunk exceeds recommended size limit         |
| `no-duplicate-lib-in-chunks` | warning  | Same package appears across multiple generated chunks     |
| `prefer-dynamic-import`      | warning  | Large dependency appears in an eagerly loaded build chunk |
| `no-base64-inline-asset`     | warning  | Build output contains inline base64 image data            |

### Accessibility (12)

| Rule                    | Severity | Description                                                       |
| ----------------------- | -------- | ----------------------------------------------------------------- |
| `img-missing-alt`       | warning  | `<img>` without `alt` attribute                                   |
| `click-needs-keyboard`  | warning  | Click handler on non-interactive element without keyboard support |
| `anchor-no-content`     | warning  | `<a>` without text content or `aria-label`                        |
| `label-without-control` | warning  | `<label>` not associated with any form control                    |
| `input-without-label`   | warning  | Form control missing an associated `<label>`                      |
| `duplicate-id`          | warning  | Duplicate `id` attribute value                                    |
| `heading-order`         | warning  | Heading levels are skipped (e.g. h1 → h3)                         |
| `aria-hidden-focus`     | warning  | Focusable element inside `aria-hidden="true"`                     |
| `no-positive-tabindex`  | warning  | Positive `tabindex` disrupts keyboard navigation order            |
| `media-has-caption`     | warning  | `<video>`/`<audio>` missing captions or transcript track          |
| `html-lang`             | warning  | `<html>` element missing a `lang` attribute                       |
| `button-has-name`       | warning  | `<button>` without text content or `aria-label`                   |

### State & Reactivity (6)

| Rule                                | Severity | Description                                                                    |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------ |
| `no-unnecessary-state`              | warning  | `$state` wrapping a value that is never mutated (fixable)                      |
| `no-derived-side-effect`            | error    | Side effects inside `$derived`                                                 |
| `prefer-runes`                      | warning  | `svelte/store` imports in a runes-mode project                                 |
| `no-unwritten-store`                | warning  | `writable` store that is never written via `.set()`, `.update()` or `$store =` |
| `no-mixed-runes-and-stores`         | warning  | Both `$state`/`$derived` and `svelte/store` used in the same component         |
| `no-unnecessary-derived-dependency` | warning  | `$derived()` reads no reactive state — should be a plain `const`               |

### Deep Runes (4)

Rules in this category catch subtle Svelte 5 runes anti-patterns that degrade reactivity correctness or runtime performance. They operate on both `.svelte` files and `.svelte.js`/`.svelte.ts` module files using TypeScript AST.

| Rule                             | Severity | Description                                                                       |
| -------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `no-untrack-misuse`              | warning  | Reactive read inside `untrack()` breaks reactivity tracking (fixable)             |
| `no-unnecessary-snapshot`        | warning  | `$state.snapshot()` creates an unnecessary deep copy where spread works (fixable) |
| `no-deep-derived-chain`          | warning  | Chain of 3+ `$derived` values reading each other causes cascading recomputation   |
| `no-expensive-props-destructure` | warning  | `$props()` destructuring with default objects/arrays allocates on every render    |

---

## Node.js API

`svelte-doctor` also exposes a programmatic API for embedding scans in your own tooling:

```typescript
import { diagnose } from "svelte-doctor/api";

const result = await diagnose("./path/to/your/svelte-project");

console.log(result.score); // { score: 82, label: "Good" }
console.log(result.diagnostics); // Diagnostic[]
console.log(result.project); // ProjectInfo
```

---

## License

This project has been developed under the [Apache License 2.0](./LICENSE).

<p align="center">
  Built by <a href="https://github.com/Pimatis"><strong>Pimatis</strong></a>
</p>
