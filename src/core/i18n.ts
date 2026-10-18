import fs from "node:fs";
import path from "node:path";
import type { Diagnostic, I18nConfig } from "../types.js";
import { IGNORED_DIRS } from "../constants.js";
import { collectProjectFiles } from "../fs/walker.js";
import { toPosix } from "../fs/normalize.js";
import { validateDirectory } from "../fs/validate.js";
import { offsetToPosition } from "../parser/lines.js";

// translation completeness: compare the keys actually referenced in code against
// every locale catalog, so missing, untranslated and orphaned keys are visible
// before a user finds them in production.

export interface CatalogEntry {
  locale: string;
  file: string;
  keyCount: number;
  keys: Map<string, { line: number; column: number }>;
}

export interface KeyUsage {
  key: string;
  file: string;
  line: number;
  column: number;
}

export interface I18nResult {
  detected: boolean;
  locales: string[];
  baseLocale: string | null;
  catalogs: CatalogEntry[];
  usages: KeyUsage[];
  missing: KeyUsage[];
  untranslated: Array<{ locale: string; key: string; file: string; line: number; column: number }>;
  unused: Array<{ locale: string; key: string; file: string; line: number; column: number }>;
  diagnostics: Diagnostic[];
}

const CATALOG_DIRS = new Set(["messages", "locales", "locale", "i18n", "intl", "translations"]);
const LOCALE_FILE = /^([a-z]{2}(?:[-_][A-Za-z]{2,4})?)\.json$/;
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;

const localeFromPath = (relativePath: string): string => {
  const parsed = path.parse(relativePath);
  const match = LOCALE_FILE.exec(parsed.base);
  if (match) return match[1];

  const base = parsed.name.replace(/\.(messages|translations|i18n)$/i, "");
  const segments = parsed.dir.split("/").filter(Boolean);
  const index = segments.findIndex((segment) => CATALOG_DIRS.has(segment.toLowerCase()));
  if (index >= 0 && segments[index + 1]) return segments[index + 1];
  return base;
};

// call shapes: $_('a.b'), $t('a.b'), t('a.b'), translate(), format(), i18n.t()/
// i18n._(), messages.foo(), and paraglide's m.foo_bar()
const STRING_KEY_CALL =
  /(?:\$_(?:\.\w+)?|\$t|(?<![.\w])(?:t|translate|format)|i18n\.(?:_|t|translate)|messages\.\w+)\s*\(\s*["'`]([A-Za-z0-9_@.:\-/]+)["'`]/g;
const PARAGLIDE_CALL = /(?<![.\w])m\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

const flattenKeys = (value: unknown, prefix: string, out: Map<string, string[]>): void => {
  if (typeof value === "string") {
    out.set(prefix, out.get(prefix) ?? []);
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    flattenKeys(child, prefix ? `${prefix}.${key}` : key, out);
  }
};

const findKeyLine = (raw: string, key: string): { line: number; column: number } => {
  const leaf = key.split(".").pop() ?? key;
  const lines = raw.split("\n");
  const escaped = leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`["']${escaped}["']\\s*:`);

  for (let i = lines.length - 1; i >= 0; i--) {
    const match = pattern.exec(lines[i]);
    if (match) return { line: i + 1, column: match.index + 1 };
  }

  return { line: 1, column: 1 };
};

// a locale json is any `xx.json` / `xx-YY.json` that sits in a catalog folder or
// shares its folder with another locale file. a lone `xx.json` somewhere else is
// far more likely to be test data than a translation catalog.
const isCatalogDirPath = (dirPath: string): boolean =>
  dirPath.split("/").some((segment) => CATALOG_DIRS.has(segment.toLowerCase()));

const collectCatalogFiles = (directory: string, config: I18nConfig | null): string[] => {
  const files: string[] = [];
  const visited = new Set<string>();

  const walk = (root: string, accept: (relativePath: string) => boolean): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }

    const localJson: string[] = [];
    const directories: string[] = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        directories.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) localJson.push(fullPath);
    }

    // locale-coded siblings in the same folder make each other credible
    const localeSiblings = localJson.filter((file) => LOCALE_FILE.test(path.basename(file))).length;

    for (const file of localJson) {
      if (visited.has(file)) continue;
      const relative = toPosix(path.relative(directory, file));
      const isLocaleNamed = LOCALE_FILE.test(path.basename(file));
      const accepted =
        accept(relative) ||
        (isLocaleNamed && (isCatalogDirPath(path.dirname(relative)) || localeSiblings >= 2));
      if (!accepted) continue;
      visited.add(file);
      files.push(file);
    }

    for (const dir of directories) walk(dir, accept);
  };

  if (config?.dirs && config.dirs.length > 0) {
    for (const dir of config.dirs) {
      const absolute = path.resolve(directory, dir);
      try {
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      } catch {
        continue;
      }
      walk(absolute, () => true);
    }
  } else {
    walk(directory, (relative) => isCatalogDirPath(path.dirname(relative)));
  }

  return [...new Set(files)].sort();
};

const collectUsages = (directory: string): KeyUsage[] => {
  const manifest = collectProjectFiles(directory);
  const usages: KeyUsage[] = [];

  for (const file of [...manifest.svelteFiles, ...manifest.scriptFiles]) {
    let source: string;
    try {
      source = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    const relative = toPosix(path.relative(directory, file));

    const record = (key: string, index: number) => {
      const { line, column } = offsetToPosition(source, index);
      usages.push({ key, file: relative, line, column });
    };

    STRING_KEY_CALL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STRING_KEY_CALL.exec(source)) !== null) {
      record(match[1], match.index);
    }

    PARAGLIDE_CALL.lastIndex = 0;
    while ((match = PARAGLIDE_CALL.exec(source)) !== null) {
      const raw = match[1];
      record(raw, match.index);
      const dotted = raw.replace(/_/g, ".");
      if (dotted !== raw) record(dotted, match.index);
    }
  }

  return usages;
};

const MAX_DIAGNOSTICS = 300;

export const analyzeI18n = (directory: string, config: I18nConfig | null = null): I18nResult => {
  validateDirectory(directory);

  const catalogFiles = collectCatalogFiles(directory, config);
  const catalogs: CatalogEntry[] = [];

  for (const file of catalogFiles) {
    let raw: string;
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || stat.size > MAX_CATALOG_BYTES) continue;
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const keys = new Map<string, { line: number; column: number }>();
    const flat = new Map<string, string[]>();
    flattenKeys(parsed, "", flat);
    for (const key of flat.keys()) keys.set(key, findKeyLine(raw, key));

    catalogs.push({
      locale: localeFromPath(toPosix(path.relative(directory, file))),
      file: toPosix(path.relative(directory, file)),
      keyCount: keys.size,
      keys,
    });
  }

  if (catalogs.length === 0) {
    return {
      detected: false,
      locales: [],
      baseLocale: null,
      catalogs: [],
      usages: [],
      missing: [],
      untranslated: [],
      unused: [],
      diagnostics: [],
    };
  }

  const locales = catalogs.map((catalog) => catalog.locale);
  const configuredBase = config?.baseLocale ?? null;
  const localeHasKeys = (locale: string): boolean =>
    (catalogs.find((catalog) => catalog.locale === locale)?.keyCount ?? 0) > 0;

  // a catalog with no keys cannot anchor the comparison: prefer the configured
  // locale, then "en", then the first locale that actually defines keys
  const candidates = [
    configuredBase,
    "en",
    ...locales.filter((locale) => localeHasKeys(locale)),
  ].filter((locale): locale is string => typeof locale === "string" && locales.includes(locale));

  const baseLocale = candidates.find((locale) => localeHasKeys(locale)) ?? null;

  if (!baseLocale) {
    return {
      detected: false,
      locales,
      baseLocale: null,
      catalogs,
      usages: [],
      missing: [],
      untranslated: [],
      unused: [],
      diagnostics: [],
    };
  }

  const baseCatalog = catalogs.find((catalog) => catalog.locale === baseLocale) ?? catalogs[0];

  const usages = collectUsages(directory);
  const usedKeys = new Set(usages.map((usage) => usage.key));

  // catalog keys are dot-paths, but paraglide-style calls use snake_case member
  // names, so accept either spelling before calling a key missing
  const alternateForms = (key: string): string[] => [
    key.replace(/_/g, "."),
    key.replace(/\./g, "_"),
  ];
  const isDefined = (key: string): boolean =>
    baseCatalog.keys.has(key) || alternateForms(key).some((form) => baseCatalog.keys.has(form));

  const diagnostics: Diagnostic[] = [];

  const missing = usages.filter((usage) => !isDefined(usage.key));
  const missingSeen = new Set<string>();
  for (const usage of missing) {
    const dedupeKey = `${usage.key}:${usage.file}:${usage.line}`;
    if (missingSeen.has(dedupeKey)) continue;
    missingSeen.add(dedupeKey);
    if (diagnostics.length >= MAX_DIAGNOSTICS) break;
    diagnostics.push({
      filePath: usage.file,
      rule: "i18n-missing-key",
      severity: "error",
      message: `Translation key \`${usage.key}\` is used but not defined in the \`${baseCatalog.locale}\` catalog`,
      help: `Add \`${usage.key}\` to ${baseCatalog.file}. Referencing an undefined key renders the raw key (or throws) at runtime.`,
      line: usage.line,
      column: usage.column,
      category: "I18n",
    });
  }

  const untranslated: I18nResult["untranslated"] = [];
  for (const catalog of catalogs) {
    if (catalog === baseCatalog) continue;
    for (const key of baseCatalog.keys.keys()) {
      if (catalog.keys.has(key)) continue;
      const position = baseCatalog.keys.get(key) ?? { line: 1, column: 1 };
      untranslated.push({
        locale: catalog.locale,
        key,
        file: catalog.file,
        line: position.line,
        column: position.column,
      });
      if (diagnostics.length >= MAX_DIAGNOSTICS) continue;
      diagnostics.push({
        filePath: baseCatalog.file,
        rule: "i18n-untranslated-key",
        severity: "warning",
        message: `Key \`${key}\` is missing from the \`${catalog.locale}\` catalog`,
        help: `Translate \`${key}\` in ${catalog.file}. Untranslated keys normally fall back to the base locale, which shows the wrong language to users.`,
        line: position.line,
        column: position.column,
        category: "I18n",
      });
    }
  }

  const unused: I18nResult["unused"] = [];
  for (const catalog of catalogs) {
    for (const [key, position] of catalog.keys) {
      if (usedKeys.has(key)) continue;
      unused.push({
        locale: catalog.locale,
        key,
        file: catalog.file,
        line: position.line,
        column: position.column,
      });
      if (catalog !== baseCatalog) continue;
      if (diagnostics.length >= MAX_DIAGNOSTICS) continue;
      diagnostics.push({
        filePath: catalog.file,
        rule: "i18n-unused-key",
        severity: "warning",
        message: `Translation key \`${key}\` is never referenced in the codebase`,
        help: "Remove the key from every catalog, or wire it up. Dead translations still cost review and translation budget.",
        line: position.line,
        column: position.column,
        category: "I18n",
      });
    }
  }

  return {
    detected: true,
    locales,
    baseLocale: baseCatalog.locale,
    catalogs,
    usages,
    missing,
    untranslated,
    unused,
    diagnostics,
  };
};
