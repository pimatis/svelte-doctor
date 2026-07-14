import { spawn } from "node:child_process";
import {
  NPM_REGISTRY_PACKAGE_URL,
  PACKAGE_NAME,
  UPDATE_CHECK_TIMEOUT_MS,
  VERSION,
} from "../constants.js";
import type { PackageManager, UpdateOptions, UpdateResult } from "../types.js";
import { resolvePackageManager } from "./runtime.js";

const isPackageManager = (value: string): value is PackageManager =>
  value === "npm" || value === "pnpm" || value === "bun";

type FetchLike = typeof fetch;

type InstallCommandResult = {
  ok: boolean;
  status: "ok" | "missing-binary" | "command-failed";
};

export const parseLatestVersion = (data: unknown): string => {
  if (typeof data !== "object" || data === null) {
    throw new Error("Registry response is not a valid JSON object");
  }

  const latest = (
    data as {
      "dist-tags"?: {
        latest?: unknown;
      };
    }
  )["dist-tags"]?.latest;

  if (typeof latest !== "string" || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(latest)) {
    throw new Error("Registry response is missing a valid dist-tags.latest version");
  }

  return latest;
};

export const fetchLatestVersion = async (fetchImpl: FetchLike = fetch): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

  try {
    const response = await fetchImpl(NPM_REGISTRY_PACKAGE_URL, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Registry request failed with status ${response.status}`);
    }

    return parseLatestVersion(await response.json());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Registry request timed out after ${UPDATE_CHECK_TIMEOUT_MS}ms`, {
        cause: error,
      });
    }

    throw error instanceof Error ? error : new Error("Failed to fetch latest package version");
  } finally {
    clearTimeout(timeout);
  }
};

const detectPackageManagerFromUserAgent = (userAgent: string): PackageManager | null => {
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("bun/")) return "bun";
  if (userAgent.startsWith("npm/")) return "npm";
  return null;
};

const isBunRuntime = (): boolean => {
  return typeof globalThis === "object" && "Bun" in globalThis;
};

export const detectPackageManager = (
  directory: string = process.cwd(),
  userAgent: string = process.env.npm_config_user_agent ?? "",
): PackageManager => {
  const detectedFromAgent = detectPackageManagerFromUserAgent(userAgent);
  if (detectedFromAgent) return detectedFromAgent;

  const detectedFromDirectory = resolvePackageManager(directory);
  if (detectedFromDirectory === "bun" || detectedFromDirectory === "pnpm") {
    return detectedFromDirectory;
  }

  if (isBunRuntime()) return "bun";
  return "npm";
};

export const buildInstallCommand = (
  manager: PackageManager,
  tag: "latest" = "latest",
): string[] => {
  const packageTarget = `${PACKAGE_NAME}@${tag}`;

  switch (manager) {
    case "pnpm":
      return ["pnpm", "add", "-g", packageTarget];
    case "bun":
      return ["bun", "add", "-g", packageTarget];
    case "npm":
    default:
      return ["npm", "install", "-g", packageTarget];
  }
};

export const runInstallCommand = async (
  command: string[],
  spawnImpl: typeof spawn = spawn,
): Promise<InstallCommandResult> =>
  new Promise((resolve) => {
    const [bin, ...args] = command;
    const child = spawnImpl(bin, args, { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, status: "ok" });
        return;
      }

      resolve({ ok: false, status: "command-failed" });
    });
    child.on("error", () => resolve({ ok: false, status: "missing-binary" }));
  });

export const runUpdate = async (options: UpdateOptions = {}): Promise<UpdateResult> => {
  const tag = options.tag ?? "latest";
  const manager = options.manager ?? detectPackageManager();

  if (!isPackageManager(manager)) {
    throw new Error(`Unsupported package manager "${String(manager)}"`);
  }

  const currentVersion = VERSION;
  const latestVersion = await fetchLatestVersion();
  const installCommand = buildInstallCommand(manager, tag);
  const alreadyLatest = currentVersion === latestVersion;

  if (options.checkOnly || options.dryRun || alreadyLatest) {
    return {
      packageName: PACKAGE_NAME,
      currentVersion,
      latestVersion,
      manager,
      installCommand,
      updated: false,
      alreadyLatest,
      dryRun: options.dryRun ?? false,
    };
  }

  const updated = await runInstallCommand(installCommand);
  if (!updated.ok) {
    if (updated.status === "missing-binary") {
      throw new Error(`Install binary not found for update command: ${installCommand[0]}`);
    }

    throw new Error(`Global update command failed: ${installCommand.join(" ")}`);
  }

  return {
    packageName: PACKAGE_NAME,
    currentVersion,
    latestVersion,
    manager,
    installCommand,
    updated: true,
    alreadyLatest: false,
    dryRun: false,
  };
};
