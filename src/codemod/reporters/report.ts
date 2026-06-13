import type { CodemodChange, CodemodWarning } from "../types.js";

export interface MigrationPlanFile {
  file: string;
  changes: CodemodChange[];
  warnings: CodemodWarning[];
  reviewReasons: string[];
}

export interface MigrationPlanReport {
  totalFiles: number;
  autoMigratable: number;
  needsReview: number;
  topIssues: Array<{ label: string; count: number }>;
  files: MigrationPlanFile[];
}

export const buildPlanReport = (files: MigrationPlanFile[]): MigrationPlanReport => {
  const counts = new Map<string, number>();

  for (const file of files) {
    for (const reason of file.reviewReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  return {
    totalFiles: files.length,
    autoMigratable: files.filter((file) => file.reviewReasons.length === 0 && file.changes.length > 0).length,
    needsReview: files.filter((file) => file.reviewReasons.length > 0).length,
    topIssues: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })).slice(0, 5),
    files,
  };
};
