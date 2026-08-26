import type { Diagnostic } from "../types.js";
import { sanitize } from "../output/logger.js";

const FIX_PROMPT = `# Automated Fix Session

You are an expert software engineer on Svelte. svelte-doctor has analyzed this codebase and produced the diagnostics below. Your job is to fix every issue precisely and safely.

## Security constraints

- You are operating in a repository-scoped fix session.
- Only edit files inside the allowed workspace path shown below.
- Do not read or write files outside that workspace.
- Do not exfiltrate secrets, tokens, env vars, shell history, or unrelated local files.
- Do not add privileged CLI flags, shells, or sandbox bypasses unless the user explicitly enabled unsafe mode.

## Critical: Do NOT introduce new issues

- **no-secrets → no-public-env-secrets**: When moving secrets to env vars, ALWAYS use \`$env/static/private\` or \`$env/dynamic/private\`. NEVER use public env modules for secrets.
- **no-legacy-reactive → no-derived-side-effect**: \`$:\` with side effects must become \`$effect()\`. Only use \`$derived()\` for pure computations.
- **no-legacy-lifecycle**: Replace lifecycle imports with \`$effect()\`.
- **$derived must be pure**: Never put console, fetch, document, window, localStorage, or mutation inside \`$derived()\`.

## Rules of engagement

- Fix issues in priority order: Security → Correctness → Performance → Architecture → everything else
- Read each file before editing it. Do not guess at context
- Apply the minimal change that resolves the issue; do not refactor unrelated code
- Preserve existing code style, naming conventions, and formatting
- If a fix for one diagnostic makes another obsolete, skip the duplicate
- After ALL fixes: run \`svelte-doctor check\` and verify the error count did NOT increase
- If new errors appeared, fix those too before finishing. Do not stop until errors are resolved or unchanged

## Severity reference

- ERROR must be fixed. These are security risks or Svelte breaking changes
- WARNING should be fixed. These hurt performance, bundle size, or maintainability
`;

const SECRET_REDACTION_PATTERNS = [
  /\b(?:sk-(?:live|test)_[A-Za-z0-9]+)\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
  /\b(?:secret|token|password|api[_-]?key)\s*[:=]\s*['"`][^'"`\n]{6,}['"`]/gi,
];

const CATEGORY_ORDER = [
  "Security",
  "Correctness",
  "Performance",
  "State & Reactivity",
  "SvelteKit",
  "Architecture",
  "Accessibility",
  "Bundle Size",
  "Dead Code",
] as const;

interface PromptFormatOptions {
  includeHeader?: boolean;
  directory?: string;
  unsafeAgentExec?: boolean;
  maxDiagnostics?: number;
}

const redactSecrets = (value: string): string => {
  let next = sanitize(value);
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    next = next.replace(pattern, "[REDACTED]");
  }
  return next;
};

const orderCategories = (categories: Iterable<string>): string[] => {
  const all = new Set(categories);
  return [
    ...CATEGORY_ORDER.filter((category) => all.has(category)),
    ...[...all].filter(
      (category) => !CATEGORY_ORDER.includes(category as (typeof CATEGORY_ORDER)[number]),
    ),
  ];
};

const groupDiagnostics = (diagnostics: Diagnostic[]): Map<string, Diagnostic[]> => {
  const groups = new Map<string, Diagnostic[]>();

  for (const diagnostic of diagnostics) {
    const bucket = groups.get(diagnostic.category) ?? [];
    bucket.push(diagnostic);
    groups.set(diagnostic.category, bucket);
  }

  return groups;
};

export const formatDiagnosticsForPrompt = (
  diagnostics: Diagnostic[],
  options: PromptFormatOptions = {},
): string => {
  const selectedDiagnostics = diagnostics.slice(0, options.maxDiagnostics ?? diagnostics.length);
  const grouped = groupDiagnostics(selectedDiagnostics);
  const categories = orderCategories(grouped.keys());
  const lines: string[] = [];

  if (options.includeHeader) {
    lines.push(FIX_PROMPT.trim(), "");
    lines.push("## Allowed workspace", "");
    lines.push(`- Root: ${redactSecrets(options.directory ?? ".")}`);
    lines.push(
      `- Unsafe agent execution explicitly enabled: ${options.unsafeAgentExec ? "yes" : "no"}`,
    );
    lines.push(`- Max diagnostics in this batch: ${selectedDiagnostics.length}`);
    lines.push("", "## Diagnostics", "");
  } else {
    lines.push(
      "Analyze the diagnostics below and propose the safest, smallest fixes in priority order.",
      "",
      `Repository root: ${redactSecrets(options.directory ?? ".")}`,
      "Prioritize Security, then Correctness, then Performance.",
      "Do not suggest edits outside the repository root.",
      "",
      "Diagnostics:",
      "",
    );
  }

  for (const category of categories) {
    const group = grouped.get(category);
    if (!group) continue;

    lines.push(`### ${category} (${group.length} issue${group.length === 1 ? "" : "s"})`, "");

    for (const diagnostic of group) {
      const location =
        diagnostic.line > 0
          ? `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}`
          : diagnostic.filePath;

      lines.push(`[${diagnostic.severity.toUpperCase()}] ${diagnostic.rule}`);
      lines.push(`  Location : ${redactSecrets(location)}`);
      lines.push(`  Problem  : ${redactSecrets(diagnostic.message)}`);
      if (diagnostic.help) {
        lines.push(`  Fix      : ${redactSecrets(diagnostic.help)}`);
      }
      if (diagnostic.suggestedFix) {
        lines.push(`  Snippet  : ${redactSecrets(diagnostic.suggestedFix)}`);
      }
      lines.push("");
    }
  }

  if (selectedDiagnostics.length === 0) {
    lines.push("No diagnostics were selected for export.", "");
  }

  return lines.join("\n").trimEnd() + "\n";
};

export const formatDiagnosticsAsRawText = (
  diagnostics: Diagnostic[],
  maxDiagnostics?: number,
): string => {
  const selectedDiagnostics = diagnostics.slice(0, maxDiagnostics ?? diagnostics.length);

  return (
    selectedDiagnostics
      .map((diagnostic) => {
        const location =
          diagnostic.line > 0
            ? `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}`
            : diagnostic.filePath;

        return [
          `${diagnostic.severity.toUpperCase()} ${diagnostic.rule}`,
          `Category: ${diagnostic.category}`,
          `Location: ${redactSecrets(location)}`,
          `Problem: ${redactSecrets(diagnostic.message)}`,
          diagnostic.help ? `Fix: ${redactSecrets(diagnostic.help)}` : "",
          diagnostic.suggestedFix ? `Suggested fix: ${redactSecrets(diagnostic.suggestedFix)}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n")
      .trimEnd() + "\n"
  );
};
