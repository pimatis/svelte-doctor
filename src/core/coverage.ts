import fs from "node:fs";
import path from "node:path";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";

export interface TestGap {
  sourceFile: string;
  expectedTests: string[];
  criticalReasons: string[];
}

export interface TestGapResult {
  sourceFiles: number;
  testFiles: number;
  gaps: TestGap[];
}

const TEST_FILE_PATTERN = /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

const isCriticalSource = (filePath: string, source: string): string[] => {
  const reasons: string[] = [];
  if (/\+page\.server\.[cm]?[jt]s$|\+layout\.server\.[cm]?[jt]s$/.test(filePath)) reasons.push("server load");
  if (/export\s+const\s+actions\b/.test(source)) reasons.push("form actions");
  return reasons;
};

export const findTestGaps = (directory: string): TestGapResult => {
  validateDirectory(directory);
  const manifest = collectProjectFiles(directory);
  const files = [...manifest.svelteFiles, ...manifest.scriptFiles];
  const relativeFiles = new Set(files.map((file) => toPosix(path.relative(directory, file))));
  const sourceFiles = files.filter((file) => !TEST_FILE_PATTERN.test(toPosix(path.relative(directory, file))));
  const testFiles = files.length - sourceFiles.length;
  const gaps: TestGap[] = [];

  for (const sourceFile of sourceFiles) {
    const relativePath = toPosix(path.relative(directory, sourceFile));
    const parsed = path.parse(relativePath);
    const expectedTests = [
      toPosix(path.join(parsed.dir, `${parsed.name}.test.ts`)),
      toPosix(path.join(parsed.dir, `${parsed.name}.spec.ts`)),
      toPosix(path.join("test", `${parsed.name}.test.ts`)),
    ];
    const hasTest = expectedTests.some((candidate) => relativeFiles.has(candidate));
    const source = fs.readFileSync(sourceFile, "utf-8");
    const criticalReasons = isCriticalSource(relativePath, source);

    if (hasTest && criticalReasons.length === 0) continue;
    if (hasTest && criticalReasons.length > 0) continue;

    gaps.push({ sourceFile: relativePath, expectedTests, criticalReasons });
  }

  return { sourceFiles: sourceFiles.length, testFiles, gaps };
};
