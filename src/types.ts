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
}

export interface RuleContext {
  filePath: string;
  source: string;
  ast: any;
  projectInfo: ProjectInfo;
}

export interface Rule {
  name: string;
  category: RuleCategory;
  severity: Severity;
  message: string;
  help: string;
  check: (ctx: RuleContext) => Diagnostic[];
}

export interface AgentInfo {
  name: string;
  command: string;
  available: boolean;
}
