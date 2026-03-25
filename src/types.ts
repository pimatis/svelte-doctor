export type Framework = "sveltekit" | "vite" | "vanilla" | "unknown";

export type RuleCategory =
  | "Correctness"
  | "Performance"
  | "Architecture"
  | "SvelteKit"
  | "Security"
  | "Bundle Size"
  | "Dead Code"
  | "Accessibility"
  | "State & Reactivity";

export type Severity = "error" | "warning";
export type FileKind = "svelte" | "script";
export type RuleAppliesTo = FileKind | "all";
export type RuleCost = "low" | "medium" | "high";
export type DeadCodeMode = "off" | "lazy" | "full";
export type VerificationLevel = "diagnostics" | "typecheck" | "tests" | "full";
export type PackageManager = "npm" | "pnpm" | "bun";
export type CopyOutput = "clipboard" | "stdout" | "file";
export type CopyFormat = "prompt" | "raw";
export type FailOn = "never" | "error" | "warning";
export type ScriptBlockKind = "instance" | "module" | "script";

export interface RuleDocs {
  summary?: string;
  whyItMatters?: string;
  safeFix?: string;
}

export interface ScriptAstContext {
  filePath: string;
  source: string;
  startLine: number;
  endLine: number;
  isTypeScript: boolean;
  kind: ScriptBlockKind;
  sourceFile: any;
}

export interface Diagnostic {
  filePath: string;
  rule: string;
  severity: Severity;
  message: string;
  help: string;
  line: number;
  column: number;
  category: RuleCategory;
  weight?: number;
  fingerprint?: string;
  fixable?: boolean;
  workspace?: string;
}

export interface ProjectInfo {
  rootDirectory: string;
  projectName: string;
  svelteVersion: string | null;
  framework: Framework;
  hasTypeScript: boolean;
  hasPreprocess: boolean;
  sourceFileCount: number;
  usesRunes: boolean;
}

export interface ProjectFileManifest {
  svelteFiles: string[];
  scriptFiles: string[];
  sourceFileCount: number;
}

export interface ScoreResult {
  score: number;
  label: string;
  totalPenalty: number;
  categoryBreakdown: Partial<Record<RuleCategory, {
    count: number;
    errors: number;
    warnings: number;
    penalty: number;
  }>>;
}

export interface ScanMeta {
  totalDiagnostics: number;
  suppressedCount: number;
  fixableCount: number;
  totalFiles: number;
  affectedFiles: number;
  elapsedMs: number;
  baselineApplied: boolean;
  targetMode: "full" | "subset";
}

export interface ScanResult {
  diagnostics: Diagnostic[];
  scoreResult: ScoreResult;
  meta: ScanMeta;
}

export interface ScanOptions {
  lint?: boolean;
  deadCode?: boolean;
  deadCodeMode?: DeadCodeMode;
  cache?: boolean;
  scoreOnly?: boolean;
  json?: boolean;
  quiet?: boolean;
  targetFiles?: string[];
  baseline?: boolean;
  failOn?: FailOn;
  minScore?: number;
}

export interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

export interface SvelteDoctorConfig {
  ignore?: {
    rules?: string[];
    files?: string[];
  };
  lint?: boolean;
  deadCode?: boolean;
  cache?: boolean;
  watch?: {
    deadCode?: DeadCodeMode;
  };
  fix?: {
    verifyLevel?: VerificationLevel;
    maxFiles?: number;
  };
}

export interface RuleContextMeta {
  hasScript: boolean;
  hasStyle: boolean;
}

export interface RuleContext {
  filePath: string;
  source: string;
  lines: string[];
  fileKind: FileKind;
  ast: any;
  scriptBlocks: ScriptAstContext[];
  projectInfo: ProjectInfo;
  analysisMeta: RuleContextMeta;
}

export interface Rule {
  name: string;
  category: RuleCategory;
  severity: Severity;
  message: string;
  help: string;
  appliesTo?: RuleAppliesTo[];
  requiresAst?: boolean;
  cost?: RuleCost;
  autofixable?: boolean;
  docs?: RuleDocs;
  check: (ctx: RuleContext) => Diagnostic[];
}

export interface AgentInfo {
  name: string;
  command: string;
  /** CLI flag value for --agent (defaults to command when omitted) */
  id?: string;
  /** Extra CLI args for the selected execution mode */
  getSpawnArgs?: (cwd: string, mode: "safe" | "unsafe") => string[];
  /** If true, pass prompt as last CLI arg instead of stdin (Cursor does not read stdin) */
  usePromptAsArg?: boolean;
  /** Format raw streaming output (e.g. JSONL) into readable lines; return null to skip */
  formatStreamingOutput?: (line: string) => string | null;
  available: boolean;
}

export interface ScanCacheEntry {
  filePath: string;
  mtimeMs: number;
  size: number;
  diagnostics: Diagnostic[];
}

export interface ScanCacheData {
  version: number;
  files: Record<string, ScanCacheEntry>;
  deadCode?: {
    diagnostics: Diagnostic[];
    sourceSignature: string;
  };
}

export interface UpdateOptions {
  checkOnly?: boolean;
  dryRun?: boolean;
  manager?: PackageManager;
  tag?: "latest";
  json?: boolean;
}

export interface UpdateResult {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  manager: PackageManager;
  installCommand: string[];
  updated: boolean;
  alreadyLatest: boolean;
  dryRun: boolean;
}

export interface CopyOptions {
  enabled?: boolean;
  output?: CopyOutput;
  filePath?: string;
  maxDiagnostics?: number;
  errorsOnly?: boolean;
  format?: CopyFormat;
}

export interface CopyResult {
  copied: boolean;
  output: CopyOutput | "stdout-fallback";
  filePath?: string;
  diagnosticsIncluded: number;
}

export interface BaselineEntry {
  fingerprint: string;
  rule: string;
  severity: Severity;
  category: RuleCategory;
  filePath: string;
  line: number;
  column: number;
  message: string;
}

export interface BaselineFile {
  version: number;
  generatedAt: string;
  entries: BaselineEntry[];
}

export interface WorkspaceInfo {
  name: string;
  directory: string;
  relativePath: string;
}

export interface ApplyOptions {
  dryRun?: boolean;
  json?: boolean;
  rules?: string[];
  write?: boolean;
  targetFiles?: string[];
}

export interface ApplyFileChange {
  filePath: string;
  changed: boolean;
  appliedRules: string[];
}

export interface ApplyResult {
  changedFiles: number;
  evaluatedFiles: number;
  appliedRules: string[];
  files: ApplyFileChange[];
  diagnosticsConsidered: number;
  write: boolean;
}
