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
export type RegressionRisk = "low" | "medium" | "high" | "critical";

export interface FixableSummary {
  autoFixable: number;
  aiFixable: number;
  manualRequired: number;
}

export interface RuleDocs {
  summary?: string;
  whyItMatters?: string;
  safeFix?: string;
}

export type PluginSource = "local" | "package";

// a plugin is a published package (svelte-doctor-plugin-*) or a local rule folder
// that contributes one or more custom Rule objects to the scan
export interface SvelteDoctorPlugin {
  name: string;
  version?: string;
  description?: string;
  homepage?: string;
  rules: Rule[];
  // set by the loader; never trust author-provided values for provenance
  meta?: PluginMeta;
}

// provenance metadata attached by the loader (not authored by the plugin)
export interface PluginMeta {
  // resolved package name for npm plugins, "local" for project rule folders
  packageName: string;
  // namespace used to build rule ids (package name or "local")
  namespace: string;
  source: PluginSource;
  // absolute path to the entry file that was executed
  entry: string;
  // true when loaded because autoDiscoverNpm scanned node_modules
  autoDiscovered: boolean;
}

// metadata about a plugin discovered and loaded for a project scan
export interface LoadedPlugin {
  name: string;
  // the namespace prefix used in rule ids (e.g. the npm package name)
  namespace: string;
  version: string | null;
  description: string | null;
  homepage: string | null;
  source: PluginSource;
  path: string;
  // npm package name when sourced from node_modules (null for local rules)
  packageName?: string;
  // true when this plugin was auto-loaded from node_modules (supply-chain surface)
  autoDiscovered: boolean;
  rules: Rule[];
}

export interface PluginConfig {
  // when false, disable every plugin and local rule (built-ins only)
  enabled?: boolean;
  // explicit npm plugin package names to load. This is the only way to run
  // third-party code by default: node_modules is NOT scanned automatically.
  include?: string[];
  // plugin package names to disable entirely
  exclude?: string[];
  // when true, every svelte-doctor-plugin-* dependency is executed. Off by
  // default because it runs arbitrary third-party code during your scan.
  autoDiscoverNpm?: boolean;
  // globs for runtime-loadable local rule files (default: svelte-doctor.rules/**\/*.{mjs,js,cjs})
  local?: string[];
}

export interface RuleLoadResult {
  rules: Rule[];
  plugins: LoadedPlugin[];
  warnings: string[];
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
  // origin plugin name when the diagnostic was produced by a custom rule
  plugin?: string;
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
  categoryBreakdown: Partial<
    Record<
      RuleCategory,
      {
        count: number;
        errors: number;
        warnings: number;
        penalty: number;
      }
    >
  >;
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
  jobs?: number;
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
  plugins?: PluginConfig | boolean;
  lint?: boolean;
  deadCode?: boolean;
  cache?: boolean;
  watch?: {
    deadCode?: DeadCodeMode;
    // auto-apply deterministic fixes when a file is saved in watch mode
    fix?: boolean | { rules?: string[] };
  };
  fix?: {
    verifyLevel?: VerificationLevel;
    maxFiles?: number;
  };
  reports?: {
    html?: string;
    junit?: string;
    markdown?: string;
  };
}

export interface ScoreHistoryEntry {
  timestamp: string;
  score: number;
  label: string;
  errors: number;
  warnings: number;
  filesScanned: number;
  filesAffected: number;
}

export interface RuleContextMeta {
  hasScript: boolean;
  hasStyle: boolean;
}

export interface RuleContext {
  filePath: string;
  projectRoot: string;
  source: string;
  compiledSource?: string;
  lines: string[];
  fileKind: FileKind;
  ast: any;
  scriptBlocks: ScriptAstContext[];
  projectInfo: ProjectInfo;
  analysisMeta: RuleContextMeta;
}

export interface Rule {
  name: string;
  // fully-qualified id: bare for built-ins, "<namespace>/<name>" for plugin/local rules.
  // set by the loader; built-in rules keep id === name.
  id?: string;
  category: RuleCategory;
  severity: Severity;
  message: string;
  help: string;
  appliesTo?: RuleAppliesTo[];
  requiresAst?: boolean;
  cost?: RuleCost;
  autofixable?: boolean;
  docs?: RuleDocs;
  // set automatically by the loader for rules contributed by a plugin
  plugin?: string;
  check: (ctx: RuleContext) => Diagnostic[];
  fix?: (source: string, diagnostic: Diagnostic) => string;
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

export interface WatchFixOptions {
  // auto-apply deterministic fixes to saved files
  enabled: boolean;
  // restrict auto-fixes to specific rules (rule names or namespaced ids)
  rules?: string[];
}

export interface WatchOptions {
  deadCode?: DeadCodeMode;
  fix?: WatchFixOptions;
}

export interface ApplyFileChange {
  filePath: string;
  changed: boolean;
  appliedRules: string[];
  diff?: string;
}

export interface ApplyResult {
  changedFiles: number;
  evaluatedFiles: number;
  appliedRules: string[];
  files: ApplyFileChange[];
  diagnosticsConsidered: number;
  write: boolean;
}
