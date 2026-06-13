export type CodemodStageName =
  | "reactive-statement"
  | "export-let"
  | "event-dispatcher"
  | "slot"
  | "on-directive"
  | "lifecycle"
  | "let-directive"
  | "store"
  | "class-directive"
  | "module-export"
  | "snippet"
  | "svelte-options";

export interface CodemodOptions {
  stage?: CodemodStageName;
}

export interface CodemodWarning {
  stage: CodemodStageName;
  message: string;
}

export interface CodemodChange {
  stage: CodemodStageName;
  label: string;
}

export interface CodemodResult {
  content: string;
  changes: CodemodChange[];
  warnings: CodemodWarning[];
}

export interface CodemodTransformContext {
  filePath?: string;
}

export interface CodemodTransform {
  name: CodemodStageName;
  label: string;
  run: (source: string, context: CodemodTransformContext) => CodemodResult;
}

export interface LegacyDetection {
  key: string;
  label: string;
  count: number;
}

export interface ComplexityDetection {
  level: "auto" | "review";
  reasons: string[];
}
