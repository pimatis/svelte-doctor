import { parentPort, workerData } from "node:worker_threads";
import { loadProjectRules } from "../plugins/loader.js";
import { scanSingleFile } from "./scanner.js";
import { getFileStatSignature } from "./cache.js";
import type { ProjectInfo, Diagnostic, SvelteDoctorConfig, Rule } from "../types.js";

interface InitData {
  directory: string;
  projectInfo: ProjectInfo;
  userConfig: SvelteDoctorConfig | null;
}

interface ScanRequest {
  type: "scan";
  filePath: string;
  relativePath: string;
}

interface ScanResponse {
  type: "result";
  relativePath: string;
  diagnostics: Diagnostic[];
  warnings: string[];
  signature: { mtimeMs: number; size: number } | null;
}

interface ReadyMessage {
  type: "ready";
  warnings: string[];
}

const initData = workerData as InitData;

const initRules = async (): Promise<{ rules: Rule[]; warnings: string[] }> => {
  const result = await loadProjectRules(initData.directory, initData.userConfig);
  return { rules: result.rules, warnings: result.warnings };
};

let loadedRules: Rule[] = [];

const rulesPromise = initRules().then(({ rules, warnings }) => {
  loadedRules = rules;
  parentPort?.postMessage({ type: "ready", warnings } satisfies ReadyMessage);
});

parentPort?.on("message", async (msg: ScanRequest) => {
  if (msg.type !== "scan") return;

  await rulesPromise;

  const warnings: string[] = [];
  const diagnostics = scanSingleFile(
    msg.filePath,
    msg.relativePath,
    initData.projectInfo,
    loadedRules,
    warnings,
  );

  const signature = getFileStatSignature(msg.filePath);

  parentPort?.postMessage({
    type: "result",
    relativePath: msg.relativePath,
    diagnostics,
    warnings,
    signature: signature ? { mtimeMs: signature.mtimeMs, size: signature.size } : null,
  } satisfies ScanResponse);
});
