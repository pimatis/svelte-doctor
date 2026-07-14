export type CiPlatform = "github-actions" | "gitlab-ci" | "circle-ci";

export const getCiTemplate = (
  platform: CiPlatform,
  minScore: number,
): { path: string; content: string } => {
  if (platform === "gitlab-ci") {
    return {
      path: ".gitlab-ci.yml",
      content: `svelte_doctor:\n  image: oven/bun:1\n  script:\n    - bun install --frozen-lockfile\n    - bunx svelte-doctor check --fail-on warning --min-score ${minScore}\n`,
    };
  }

  if (platform === "circle-ci") {
    return {
      path: ".circleci/config.yml",
      content: `version: 2.1\njobs:\n  svelte_doctor:\n    docker:\n      - image: oven/bun:1\n    steps:\n      - checkout\n      - run: bun install --frozen-lockfile\n      - run: bunx svelte-doctor check --fail-on warning --min-score ${minScore}\nworkflows:\n  svelte_doctor:\n    jobs:\n      - svelte_doctor\n`,
    };
  }

  return {
    path: ".github/workflows/svelte-doctor.yml",
    content: `name: svelte-doctor\n\non:\n  pull_request:\n  push:\n    branches: [main, master]\n\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@v2\n      - run: bun install --frozen-lockfile\n      - run: bunx svelte-doctor check --fail-on warning --min-score ${minScore}\n`,
  };
};
