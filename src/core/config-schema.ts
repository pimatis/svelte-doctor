export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://svelte-doctor.dev/svelte-doctor.config.schema.json",
  title: "svelte-doctor configuration",
  type: "object",
  additionalProperties: false,
  properties: {
    lint: { type: "boolean" },
    deadCode: { type: "boolean" },
    cache: { type: "boolean" },
    watch: {
      type: "object",
      additionalProperties: false,
      properties: {
        deadCode: { enum: ["off", "lazy", "full"] },
        fix: {
          anyOf: [
            { type: "boolean" },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                rules: { type: "array", items: { type: "string", minLength: 1 } },
              },
            },
          ],
        },
      },
    },
    fix: {
      type: "object",
      additionalProperties: false,
      properties: {
        verifyLevel: { enum: ["diagnostics", "typecheck", "tests", "full"] },
        maxFiles: { type: "number", exclusiveMinimum: 0 },
      },
    },
    reports: {
      type: "object",
      additionalProperties: false,
      properties: {
        html: { type: "string", minLength: 1 },
        junit: { type: "string", minLength: 1 },
        markdown: { type: "string", minLength: 1 },
      },
    },
    budgets: {
      type: "object",
      additionalProperties: false,
      properties: {
        javascript: { type: "number", exclusiveMinimum: 0 },
        css: { type: "number", exclusiveMinimum: 0 },
        chunk: { type: "number", exclusiveMinimum: 0 },
        gzip: { type: "boolean" },
      },
    },
    i18n: {
      type: "object",
      additionalProperties: false,
      properties: {
        dirs: { type: "array", items: { type: "string", minLength: 1 } },
        baseLocale: { type: "string", minLength: 1 },
      },
    },
    ignore: {
      type: "object",
      additionalProperties: false,
      properties: {
        rules: { type: "array", items: { type: "string" } },
        files: { type: "array", items: { type: "string", minLength: 1 } },
      },
    },
    plugins: {
      anyOf: [
        { type: "boolean" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean" },
            include: { type: "array", items: { type: "string", minLength: 1 } },
            exclude: { type: "array", items: { type: "string", minLength: 1 } },
            autoDiscoverNpm: { type: "boolean" },
            local: { type: "array", items: { type: "string", minLength: 1 } },
          },
        },
      ],
    },
    rules: {
      type: "object",
      additionalProperties: false,
      properties: {
        categories: { type: "array", items: { type: "string" } },
        severity: { type: "object", additionalProperties: { enum: ["error", "warning"] } },
      },
    },
    ci: {
      type: "object",
      additionalProperties: false,
      properties: {
        failOn: { enum: ["never", "error", "warning"] },
        minScore: { type: "number", minimum: 0 },
        maxErrors: { type: "number", minimum: 0 },
        maxWarnings: { type: "number", minimum: 0 },
      },
    },
  },
} as const;
