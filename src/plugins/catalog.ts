// Central, community-contributable catalog of known svelte-doctor plugins.
// This list is shipped with the CLI and works fully offline. To add a plugin,
// open a pull request that appends an entry following the same shape. Entries
// are advisory: `registry add` installs the referenced npm package directly.

export interface CatalogEntry {
  name: string;
  package: string;
  description: string;
  category: string;
  author?: string;
  repository?: string;
  homepage?: string;
  // false for community-contributed entries that have not been vetted by maintainers
  verified?: boolean;
  tags?: string[];
}

export const PLUGIN_CATALOG: CatalogEntry[] = [
  {
    name: "a11y-plus",
    package: "svelte-doctor-plugin-a11y-plus",
    description:
      "Extra accessibility checks: heading order, form label association, aria-hidden misuse, and color-contrast hints.",
    category: "Accessibility",
    author: "community",
    repository: "https://github.com/Pimatis/svelte-doctor",
    tags: ["a11y", "accessibility", "wcag"],
  },
  {
    name: "team-stdlib",
    package: "svelte-doctor-plugin-team-stdlib",
    description:
      "Enforces a team's shared Svelte conventions: banned utility imports, required error boundaries, and naming rules.",
    category: "Architecture",
    author: "community",
    tags: ["conventions", "standards", "architecture"],
  },
  {
    name: "perf-extra",
    package: "svelte-doctor-plugin-perf-extra",
    description:
      "Additional performance rules: large inline data, unmemoized event handlers, and expensive store subscriptions.",
    category: "Performance",
    author: "community",
    tags: ["performance", "runtime"],
  },
];

export const findCatalogEntry = (name: string): CatalogEntry | null =>
  PLUGIN_CATALOG.find((entry) => entry.name === name) ?? null;

export const searchCatalog = (query: string): CatalogEntry[] => {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return PLUGIN_CATALOG;

  return PLUGIN_CATALOG.filter((entry) => {
    const haystack = [
      entry.name,
      entry.package,
      entry.description,
      entry.category,
      ...(entry.tags ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
};
