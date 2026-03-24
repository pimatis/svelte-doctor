import { spawn } from "node:child_process";
import { NPM_REGISTRY_PACKAGE_URL, PACKAGE_NAME, UPDATE_CHECK_TIMEOUT_MS, VERSION } from "../constants.js";
import type { PackageManager, UpdateOptions, UpdateResult } from "../types.js";

const isPackageManager = (value: string): value is PackageManager =>
  value === "npm" || value === "pnpm" || value === "bun";

export const fetchLatestVersion = async (): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(NPM_REGISTRY_PACKAGE_URL, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Registry request failed with status ${response.status}`);
    }

    const data = await response.json() as {
      "dist-tags"?: {
        latest?: unknown;
      };
    };

    const latest = data["dist-tags"]?.latest;
    if (typeof latest !== "string" || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(latest)) {
      throw new Error("Registry response is missing a valid dist-tags.latest version");
    }

    return latest;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Registry request timed out after ${UPDATE_CHECK_TIMEOUT_MS}ms`);
    }

    throw error instanceof Error
      ? error
      : new Error("Failed to fetch latest package version");
  } finally {
    clearTimeout(timeout);
  }
};

export const detectPackageManager = (): PackageManager => {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("bun/")) return "bun";
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

const runInstallCommand = async (command: string[]): Promise<boolean> =>
  new Promise((resolve) => {
    const [bin, ...args] = command;
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
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
  if (!updated) {
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
