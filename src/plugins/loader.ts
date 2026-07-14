import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  LoadedPlugin,
  PluginConfig,
  Rule,
  RuleCategory,
  RuleLoadResult,
  SvelteDoctorConfig,
  SvelteDoctorPlugin,
} from "../types.js";
import { allRules } from "../rules/index.js";

// set to any truthy value to disable every plugin/local rule (built-ins only).
// mirrors opencode's OPENCODE_DISABLE_DEFAULT_PLUGINS kill-switch.
export const PLUGIN_DISABLE_ENV = "SD_DISABLE_PLUGINS";

// third-party npm packages must opt in explicitly; node_modules is scanned for
// these only when `autoDiscoverNpm` is enabled.
const PLUGIN_NPM_PREFIX = "svelte-doctor-plugin";

const RULE_CATEGORIES: RuleCategory[] = [
  "Correctness",
  "Performance",
  "Architecture",
  "SvelteKit",
  "Security",
  "Bundle Size",
  "Dead Code",
  "Accessibility",
  "State & Reactivity",
];

const RULE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const escapeRegex = (value: string): string => value.replace(/[.+?^$()|[\]\\]/g, "\\$&");

// converts a small glob (supports **, *, and {a,b}) into an anchored RegExp
const globToRegExp = (pattern: string): RegExp => {
  let regex = "";

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        regex += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        regex += "[^/]*";
      }
      continue;
    }

    if (ch === "{") {
      const end = pattern.indexOf("}", i);
      if (end !== -1) {
        const options = pattern
          .slice(i + 1, end)
          .split(",")
          .map((option) => escapeRegex(option))
          .join("|");
        regex += `(?:${options})`;
        i = end;
        continue;
      }
      regex += escapeRegex(ch);
      continue;
    }

    regex += escapeRegex(ch);
  }

  return new RegExp(`^${regex}$`);
};

// walks the project collecting files that match any local rule glob. Never descends
// into node_modules / .git / cache dirs, and refuses to load files outside the root.
const expandLocalGlobs = (directory: string, patterns: string[]): string[] => {
  const regexes = patterns.map(globToRegExp);
  const results = new Set<string>();

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === ".svelte-doctor"
        )
          continue;
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      if (!regexes.some((re) => re.test(relative))) continue;
      if (!isInsideRoot(directory, absolute)) continue;
      results.add(absolute);
    }
  };

  walk(directory);
  return [...results].sort();
};

const isInsideRoot = (root: string, target: string): boolean => {
  const realRoot = safeRealpath(root);
  const realTarget = safeRealpath(target);
  const relative = path.relative(realRoot, realTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const safeRealpath = (target: string): string => {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
};

const readProjectPackageJson = (directory: string): Record<string, unknown> | null => {
  try {
    const raw = fs.readFileSync(path.join(directory, "package.json"), "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

// walks up from the entry point to find the nearest package.json
const readPackageVersion = (entry: string): string | null => {
  let dir = path.dirname(entry);
  const root = path.parse(dir).root;
  while (dir !== root) {
    try {
      const pkgPath = path.join(dir, "package.json");
      const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return typeof parsed?.version === "string" ? parsed.version : null;
    } catch {
      dir = path.dirname(dir);
    }
  }
  return null;
};

// resolves a package entry file relative to the project's node_modules
const resolveModuleFile = (directory: string, specifier: string): string | null => {
  try {
    const require = createRequire(path.join(directory, "package.json"));
    const resolved = require.resolve(specifier);
    return isInsideRoot(directory, resolved) ? resolved : null;
  } catch {
    return null;
  }
};

const isPluginPackageName = (name: string): boolean =>
  new RegExp(`^${PLUGIN_NPM_PREFIX}(-[a-z0-9]+)*$`).test(name) ||
  new RegExp(`^@[^/]+/${PLUGIN_NPM_PREFIX}(-[a-z0-9]+)*$`).test(name);

// friendly namespace for display: strip the canonical prefix when present
const deriveNamespace = (packageName: string): string => {
  const base = packageName.startsWith("@") ? packageName.split("/")[1] : packageName;
  return base.replace(new RegExp(`^${PLUGIN_NPM_PREFIX}-`), "") || base;
};

// module cache so repeated loads (e.g. watch mode) reuse parsed modules unless
// the file changed on disk. Keyed by absolute path + mtime to avoid stale hits.
const moduleCache = new Map<string, { mtimeMs: number; mod: unknown }>();

const importModule = async (filePath: string): Promise<unknown> => {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    /* stat failed, use mtimeMs=0 */
  }

  const cached = moduleCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.mod;

  const mod = await import(pathToFileURL(filePath).href);
  moduleCache.set(filePath, { mtimeMs, mod });
  return mod;
};

export type RuleValidation = { ok: true; rule: Rule } | { ok: false; error: string };

// validates a single rule object, rejecting malformed or unsafe shapes
export const validateRule = (value: unknown, sourceLabel: string): RuleValidation => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: `${sourceLabel}: rule must be an object` };
  }

  const rule = value as Record<string, unknown>;

  if (typeof rule.name !== "string" || !RULE_NAME_PATTERN.test(rule.name)) {
    return { ok: false, error: `${sourceLabel}: rule name must be kebab-case` };
  }
  if (
    typeof rule.category !== "string" ||
    !RULE_CATEGORIES.includes(rule.category as RuleCategory)
  ) {
    return {
      ok: false,
      error: `${sourceLabel} (${rule.name}): invalid category "${String(rule.category)}"`,
    };
  }
  if (rule.severity !== "error" && rule.severity !== "warning") {
    return {
      ok: false,
      error: `${sourceLabel} (${rule.name}): severity must be "error" or "warning"`,
    };
  }
  if (typeof rule.message !== "string" || rule.message.length === 0) {
    return {
      ok: false,
      error: `${sourceLabel} (${rule.name}): message must be a non-empty string`,
    };
  }
  if (typeof rule.help !== "string" || rule.help.length === 0) {
    return { ok: false, error: `${sourceLabel} (${rule.name}): help must be a non-empty string` };
  }
  if (typeof rule.check !== "function") {
    return { ok: false, error: `${sourceLabel} (${rule.name}): check must be a function` };
  }
  if (rule.fix !== undefined && typeof rule.fix !== "function") {
    return { ok: false, error: `${sourceLabel} (${rule.name}): fix must be a function` };
  }

  return { ok: true, rule: value as unknown as Rule };
};

// authoring helper: validates at definition time and returns the rule unchanged
export const defineRule = (rule: Rule): Rule => {
  const result = validateRule(rule, rule.name ?? "rule");
  if (!result.ok) throw new Error(result.error);
  return rule;
};

// authoring helper: validates a whole plugin at definition time
export const definePlugin = (plugin: SvelteDoctorPlugin): SvelteDoctorPlugin => {
  if (typeof plugin?.name !== "string" || plugin.name.length === 0) {
    throw new Error("plugin name is required");
  }
  if (!Array.isArray(plugin.rules)) {
    throw new Error(`plugin "${plugin.name}" must export a rules array`);
  }
  const seen = new Set<string>();
  for (const rule of plugin.rules) {
    const result = validateRule(rule, `${plugin.name}/${rule?.name ?? "?"}`);
    if (!result.ok) throw new Error(result.error);
    if (seen.has(rule.name)) {
      throw new Error(`plugin "${plugin.name}" defines rule "${rule.name}" more than once`);
    }
    seen.add(rule.name);
  }
  return plugin;
};

// normalizes many export shapes (default, named, array, plugin object, single rule)
// into a plugin so authors can export whatever is most convenient.
// invalid rules are skipped and reported as warnings rather than rejecting the entire plugin.
const extractPlugin = (
  mod: unknown,
  sourceLabel: string,
): { plugin: SvelteDoctorPlugin | null; warnings: string[] } => {
  const warnings: string[] = [];

  if (typeof mod !== "object" || mod === null) return { plugin: null, warnings };

  const def = (mod as any).default;

  let candidate: any =
    (mod as any).svelteDoctorPlugin ??
    (Array.isArray(mod) ? { name: sourceLabel, rules: mod } : undefined) ??
    (Array.isArray((mod as any).rules) ? mod : undefined);

  // the default export may be a plugin object or a single rule
  if (!candidate && def && typeof def === "object" && def !== null) {
    if (typeof def.check === "function") {
      candidate = { name: def.name ?? sourceLabel, rules: [def] };
    } else if (Array.isArray(def.rules)) {
      candidate = def;
    }
  }

  if (!candidate) return { plugin: null, warnings };

  const name =
    typeof candidate.name === "string" && candidate.name.length > 0 ? candidate.name : sourceLabel;

  if (!Array.isArray(candidate.rules)) return { plugin: null, warnings };

  const rules: Rule[] = [];
  for (const raw of candidate.rules) {
    const result = validateRule(raw, `${name}/${raw?.name ?? "?"}`);
    if (result.ok) {
      rules.push({ ...result.rule });
    } else {
      warnings.push(`Skipping invalid rule in "${name}": ${result.error}`);
    }
  }

  if (rules.length === 0) return { plugin: null, warnings };

  return {
    plugin: {
      name,
      version: typeof candidate.version === "string" ? candidate.version : undefined,
      description: typeof candidate.description === "string" ? candidate.description : undefined,
      homepage: typeof candidate.homepage === "string" ? candidate.homepage : undefined,
      rules,
    },
    warnings,
  };
};

const loadLocalRules = async (
  directory: string,
  patterns: string[],
): Promise<{ plugin: LoadedPlugin | null; warnings: string[] }> => {
  const warnings: string[] = [];
  const files = expandLocalGlobs(directory, patterns);

  if (files.length === 0) return { plugin: null, warnings };

  const rules: Rule[] = [];
  for (const file of files) {
    const relative = path.relative(directory, file);
    try {
      const mod = await importModule(file);
      const { plugin, warnings: extractWarnings } = extractPlugin(mod, "local");
      warnings.push(...extractWarnings);
      if (!plugin) {
        warnings.push(`Local rule file "${relative}" does not export a valid rule or plugin.`);
        continue;
      }
      for (const rule of plugin.rules) {
        rules.push({ ...rule, id: `local/${rule.name}`, plugin: "local" });
      }
    } catch (error) {
      warnings.push(
        `Failed to load local rule "${relative}": ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (rules.length === 0) return { plugin: null, warnings };

  return {
    plugin: {
      name: "local",
      namespace: "local",
      version: null,
      description: "Locally authored custom rules",
      homepage: null,
      source: "local",
      path: path.join(directory, "svelte-doctor.rules"),
      autoDiscovered: false,
      rules,
    },
    warnings,
  };
};

const loadExternalPlugins = async (
  directory: string,
  config: PluginConfig | null,
): Promise<{ plugins: LoadedPlugin[]; warnings: string[] }> => {
  const warnings: string[] = [];
  const pkg = readProjectPackageJson(directory);
  const dependencies = {
    ...(pkg?.dependencies as Record<string, string> | undefined),
    ...(pkg?.devDependencies as Record<string, string> | undefined),
  };

  const autoDiscover = config?.autoDiscoverNpm === true;
  const autoDiscoveredNames = new Set<string>();

  if (autoDiscover) {
    for (const name of Object.keys(dependencies)) {
      if (isPluginPackageName(name)) autoDiscoveredNames.add(name);
    }
    if (autoDiscoveredNames.size > 0) {
      warnings.push(
        `autoDiscoverNpm is enabled: executing ${autoDiscoveredNames.size} third-party package(s) from node_modules. ` +
          "Only enable this for trusted dependency sets.",
      );
    }
  }

  const explicitlyIncluded = new Set(config?.include ?? []);
  const candidates = new Set([...autoDiscoveredNames, ...explicitlyIncluded]);

  const exclude = new Set(config?.exclude ?? []);
  const plugins: LoadedPlugin[] = [];
  const seen = new Set<string>();

  for (const name of candidates) {
    if (exclude.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    const entry = resolveModuleFile(directory, name);
    if (!entry) {
      warnings.push(
        `Plugin "${name}" is declared but could not be resolved. Install it with your package manager.`,
      );
      continue;
    }

    const packageVersion = readPackageVersion(entry);

    try {
      const mod = await importModule(entry);
      const { plugin, warnings: extractWarnings } = extractPlugin(mod, name);
      warnings.push(...extractWarnings);
      if (!plugin) {
        warnings.push(`Plugin "${name}" does not export a valid svelte-doctor plugin.`);
        continue;
      }
      const namespace = name;
      plugins.push({
        name: plugin.name || deriveNamespace(name),
        namespace,
        version: plugin.version ?? packageVersion,
        description: plugin.description ?? null,
        homepage: plugin.homepage ?? null,
        source: "package",
        path: entry,
        packageName: name,
        autoDiscovered: autoDiscoveredNames.has(name) && !explicitlyIncluded.has(name),
        rules: plugin.rules.map((rule) => ({
          ...rule,
          id: `${namespace}/${rule.name}`,
          plugin: plugin.name || deriveNamespace(name),
        })),
      });
    } catch (error) {
      warnings.push(
        `Failed to load plugin "${name}": ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return { plugins, warnings };
};

// merges built-in rules with discovered local and external plugin rules.
// built-ins keep bare ids and always take precedence; plugin rules are namespaced
// ("<namespace>/<name>") so two plugins can never silently collide.
export const loadProjectRules = async (
  directory: string,
  config: SvelteDoctorConfig | null,
): Promise<RuleLoadResult> => {
  const warnings: string[] = [];
  const plugins: LoadedPlugin[] = [];

  const rawPlugins = config?.plugins;
  const pluginsDisabled =
    process.env[PLUGIN_DISABLE_ENV] !== undefined ||
    rawPlugins === false ||
    (rawPlugins !== null && typeof rawPlugins === "object" && rawPlugins.enabled === false);
  if (pluginsDisabled) {
    const rules = allRules.map((rule) => ({ ...rule, id: rule.name }));
    return { rules, plugins: [], warnings };
  }

  const pluginConfig = rawPlugins !== null && typeof rawPlugins === "object" ? rawPlugins : null;

  const localPatterns =
    pluginConfig?.local && pluginConfig.local.length > 0
      ? pluginConfig.local
      : ["svelte-doctor.rules/**/*.{mjs,js,cjs}"];

  const local = await loadLocalRules(directory, localPatterns);
  warnings.push(...local.warnings);
  if (local.plugin) plugins.push(local.plugin);

  const external = await loadExternalPlugins(directory, pluginConfig);
  warnings.push(...external.warnings);
  plugins.push(...external.plugins);

  const ruleMap = new Map<string, Rule>();
  for (const rule of allRules) ruleMap.set(rule.name, { ...rule, id: rule.name });

  for (const plugin of plugins) {
    for (const rule of plugin.rules) {
      const ruleId = rule.id ?? rule.name;
      if (ruleMap.has(ruleId)) {
        warnings.push(
          `Rule "${ruleId}" from plugin "${plugin.name}" is shadowed by an existing rule with the same id.`,
        );
        continue;
      }
      ruleMap.set(ruleId, { ...rule, id: ruleId, plugin: rule.plugin ?? plugin.name });
    }
  }

  return { rules: [...ruleMap.values()], plugins, warnings };
};
