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
}

export interface ScanResult {
  diagnostics: Diagnostic[];
  scoreResult: ScoreResult;
}

export interface ScanOptions {
  lint?: boolean;
  deadCode?: boolean;
  deadCodeMode?: DeadCodeMode;
  cache?: boolean;
  scoreOnly?: boolean;
  json?: boolean;
  quiet?: boolean;
}

export interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
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
