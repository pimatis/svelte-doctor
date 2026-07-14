import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type SafeWriteOptions = {
  mode?: number;
  pathMessage: string;
  symlinkFileMessage: string;
  symlinkDirectoryMessage: string;
};

const assertInsideRoot = (root: string, target: string, message: string): void => {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(message);
  }
};

const isInsideRoot = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const assertNoSymlinkAncestors = (root: string, target: string, message: string): void => {
  let current = path.dirname(target);

  while (current !== root) {
    assertInsideRoot(root, current, message);

    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(message);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    current = path.dirname(current);
  }
};

export const prepareSafeFileTarget = (
  rootDirectory: string,
  targetPath: string,
  options: SafeWriteOptions,
): string => {
  const root = path.resolve(rootDirectory);
  const rootReal = fs.realpathSync.native(root);
  const target = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(root, targetPath);

  const lexicallyInsideRoot = isInsideRoot(root, target);
  if (!lexicallyInsideRoot) {
    try {
      const parentReal = fs.realpathSync.native(path.dirname(target));
      const realTarget = path.join(parentReal, path.basename(target));
      assertInsideRoot(rootReal, realTarget, options.pathMessage);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(options.pathMessage, { cause: error });
      }
      throw error;
    }
  }

  if (lexicallyInsideRoot) {
    assertNoSymlinkAncestors(root, target, options.symlinkDirectoryMessage);
  }

  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      throw new Error(options.symlinkFileMessage);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  const parentReal = fs.realpathSync.native(path.dirname(target));
  const realTarget = path.join(parentReal, path.basename(target));
  assertInsideRoot(rootReal, realTarget, options.pathMessage);

  return target;
};

export const writeFileAtomicSafe = (
  rootDirectory: string,
  targetPath: string,
  contents: string,
  options: SafeWriteOptions,
): string => {
  const target = prepareSafeFileTarget(rootDirectory, targetPath, options);
  const tmpPath = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    fs.writeFileSync(tmpPath, contents, {
      encoding: "utf-8",
      mode: options.mode ?? 0o600,
      flag: "wx",
    });
    fs.renameSync(tmpPath, target);
    return target;
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* cleanup best-effort */
    }
    throw error;
  }
};
