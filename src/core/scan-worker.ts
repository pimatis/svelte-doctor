import { parentPort, workerData } from "node:worker_threads";
import { allRules } from "../rules/index.js";
import { loadProjectRules } from "../plugins/loader.js";
import { scanSingleFile } from "./scanner.js";
import { getFileStatSignature } from "./cache.js";
import type { ProjectInfo, Diagnostic, SvelteDoctorConfig } from "../types.js";

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

const initRules = async (): Promise<{ warnings: string[] }> => {
  const result = await loadProjectRules(initData.directory, initData.userConfig);
  return { warnings: result.warnings };
};

const rulesPromise = initRules();

rulesPromise.then(({ warnings }) => {
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
    allRules,
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
