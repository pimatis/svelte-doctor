import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Diagnostic, ProjectInfo, SvelteDoctorConfig } from "../types.js";
import { toPosix } from "../fs/normalize.js";

interface WorkerInitData {
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

// resolve scan-worker path for both bundled (.mjs) and dev (.ts) modes
const resolveWorkerPath = (): string => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const mjsPath = path.join(dir, "scan-worker.mjs");
  const tsPath = path.join(dir, "scan-worker.ts");

  if (fs.existsSync(mjsPath)) return mjsPath;
  if (fs.existsSync(tsPath)) return tsPath;

  throw new Error("scan-worker not found. Run `bun run build` to generate it.");
};

interface FileScanResult {
  diagnostics: Diagnostic[];
  signature: { mtimeMs: number; size: number } | null;
}

export class ScanWorkerPool {
  private workers: Worker[] = [];
  private allWarnings: string[] = [];
  private initialized = false;

  constructor(
    private readonly directory: string,
    private readonly projectInfo: ProjectInfo,
    private readonly userConfig: SvelteDoctorConfig | null,
    private readonly jobs: number,
  ) {}

  async init(): Promise<void> {
    if (this.initialized) return;

    const workerPath = resolveWorkerPath();
    const initData: WorkerInitData = {
      directory: this.directory,
      projectInfo: this.projectInfo,
      userConfig: this.userConfig,
    };

    const readyPromises: Promise<void>[] = [];

    for (let i = 0; i < this.jobs; i++) {
      const worker = new Worker(workerPath, { workerData: initData });
      this.workers.push(worker);

      readyPromises.push(
        new Promise<void>((resolve, reject) => {
          const onReady = (msg: ReadyMessage | ScanResponse) => {
            if (msg.type === "ready") {
              this.allWarnings.push(...msg.warnings);
              worker.off("message", onReady);
              resolve();
            }
          };
          worker.on("message", onReady);
          worker.on("error", reject);
        }),
      );
    }

    await Promise.all(readyPromises);
    this.initialized = true;
  }

  private scanFileWithWorker(
    workerIndex: number,
    filePath: string,
    relativePath: string,
  ): Promise<ScanResponse> {
    const worker = this.workers[workerIndex];

    return new Promise<ScanResponse>((resolve, reject) => {
      const onResult = (msg: ScanResponse | ReadyMessage) => {
    if (msg.type === "result" && msg.relativePath === relativePath) {
          worker.off("message", onResult);
          worker.off("error", onError);
          resolve(msg);
        }
      };

      const onError = (error: Error): void => {
        worker.off("message", onResult);
        worker.off("error", onError);
        reject(error);
      };

      worker.on("message", onResult);
      worker.on("error", onError);

      worker.postMessage({
        type: "scan",
        filePath,
        relativePath,
      } satisfies ScanRequest);
    });
  }

  async scanAll(
    files: string[],
    directory: string,
  ): Promise<Map<string, FileScanResult>> {
    await this.init();

    const results = new Map<string, FileScanResult>();
    const queue = [...files];

    const processQueue = async (workerIndex: number): Promise<void> => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;

        const relativePath = toPosix(path.relative(directory, file));
        const response = await this.scanFileWithWorker(workerIndex, file, relativePath);

        this.allWarnings.push(...response.warnings);
        results.set(relativePath, {
          diagnostics: response.diagnostics,
          signature: response.signature,
        });
      }
    };

    const workerPromises: Promise<void>[] = [];
    for (let w = 0; w < this.workers.length; w++) {
      workerPromises.push(processQueue(w));
    }

    await Promise.all(workerPromises);
    return results;
  }

  getWarnings(): string[] {
    return this.allWarnings;
  }

  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.initialized = false;
  }
}
