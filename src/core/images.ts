import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "../types.js";
import { toPosix } from "../fs/normalize.js";

export interface ImageAsset {
  filePath: string;
  bytes: number;
  kilobytes: number;
  format: string;
}

export interface ImageAssetReport {
  assets: ImageAsset[];
  diagnostics: Diagnostic[];
  totalAssets: number;
  totalKilobytes: number;
  oversizedCount: number;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".bmp",
  ".tiff",
  ".ico",
]);

// formats that always compress better as webp/avif at the same visual quality
const LEGACY_FORMATS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tiff"]);

const OVERSIZED_BYTES = 250 * 1024;
const MODERN_FORMAT_BYTES = 30 * 1024;
const MAX_ASSETS = 5_000;

// source asset roots win over build output so a copied file is not reported twice
const SOURCE_ROOTS = ["static", "public", "assets/static"];
const OUTPUT_ROOTS = [".svelte-kit/output/client", "build", "dist", "public/build"];

const walkImages = (root: string, projectRoot: string, out: ImageAsset[]): void => {
  if (out.length >= MAX_ASSETS) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= MAX_ASSETS) return;
    if (entry.isSymbolicLink()) continue;

    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      walkImages(fullPath, projectRoot, out);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) continue;

    let stat: fs.Stats;
    try {
      const linkStat = fs.lstatSync(fullPath);
      if (linkStat.isSymbolicLink() || !linkStat.isFile()) continue;
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    out.push({
      filePath: toPosix(path.relative(projectRoot, fullPath)),
      bytes: stat.size,
      kilobytes: Math.round(stat.size / 1024),
      format: extension.slice(1),
    });
  }
};

const existingRoots = (projectRoot: string, roots: string[]): string[] =>
  roots
    .map((root) => path.resolve(projectRoot, root))
    .filter((absolute) => {
      try {
        const stat = fs.lstatSync(absolute);
        return !stat.isSymbolicLink() && stat.isDirectory();
      } catch {
        return false;
      }
    });

export const analyzeImageAssets = (projectRoot: string): ImageAssetReport => {
  const resolvedRoot = path.resolve(projectRoot);
  const sourceRoots = existingRoots(resolvedRoot, SOURCE_ROOTS);
  const roots = sourceRoots.length > 0 ? sourceRoots : existingRoots(resolvedRoot, OUTPUT_ROOTS);

  const assets: ImageAsset[] = [];
  for (const root of roots) walkImages(root, resolvedRoot, assets);

  assets.sort((a, b) => b.bytes - a.bytes);

  const diagnostics: Diagnostic[] = [];
  let oversizedCount = 0;

  for (const asset of assets) {
    if (asset.bytes > OVERSIZED_BYTES) {
      oversizedCount++;
      diagnostics.push({
        filePath: asset.filePath,
        rule: "oversized-image-asset",
        severity: "warning",
        message: `Image asset is ${asset.kilobytes}KB — larger than the recommended 250KB budget`,
        help: "Resize the asset to the largest size it is displayed at and re-encode it. Oversized images dominate page weight and directly increase LCP and mobile data cost.",
        line: 1,
        column: 1,
        category: "Images",
      });
      continue;
    }

    if (LEGACY_FORMATS.has(`.${asset.format}`) && asset.bytes > MODERN_FORMAT_BYTES) {
      diagnostics.push({
        filePath: asset.filePath,
        rule: "prefer-modern-image-format",
        severity: "warning",
        message: `${asset.format.toUpperCase()} asset is ${asset.kilobytes}KB — webp/avif is typically 30-50% smaller`,
        help: "Re-encode as `.webp` or `.avif` (both are supported by every current browser) and keep the original as a fallback only if you must support legacy clients.",
        line: 1,
        column: 1,
        category: "Images",
      });
    }
  }

  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);

  return {
    assets,
    diagnostics,
    totalAssets: assets.length,
    totalKilobytes: Math.round(totalBytes / 1024),
    oversizedCount,
  };
};
