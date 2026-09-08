// single source of truth for mapping source lines to template regions.
// previously duplicated across rule files with diverging behavior.

type ScriptBlockInfo = { isScript: boolean; isModule: boolean };

const buildScriptBlockMap = (source: string): ScriptBlockInfo[] => {
  const lines = source.split("\n");
  const empty: ScriptBlockInfo = { isScript: false, isModule: false };
  const map: ScriptBlockInfo[] = new Array(lines.length).fill(empty);
  let inside = false;
  let isModule = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^<script[\s>]/.test(trimmed)) {
      inside = true;
      isModule = /\bcontext\s*=\s*["']module["']/.test(trimmed);
      continue;
    }
    if (trimmed === "</script>") {
      inside = false;
      isModule = false;
      continue;
    }
    map[i] = { isScript: inside, isModule };
  }

  return map;
};

export const buildScriptLineMap = (source: string): boolean[] =>
  buildScriptBlockMap(source).map((block) => block.isScript);

// lines inside <script context="module"> — reactive statements there are
// silently dropped by the Svelte 5 compiler and cannot be autofixed
export const buildModuleScriptLineMap = (source: string): boolean[] =>
  buildScriptBlockMap(source).map((block) => block.isScript && block.isModule);

export const buildStyleLineMap = (source: string): boolean[] => {
  const lines = source.split("\n");
  const map: boolean[] = new Array(lines.length).fill(false);
  let inside = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^<style[\s>]/.test(trimmed)) {
      const closesOnSameLine = /<\/style>/.test(trimmed);
      map[i] = closesOnSameLine;
      inside = !closesOnSameLine;
      continue;
    }
    if (trimmed === "</style>") {
      inside = false;
      continue;
    }
    map[i] = inside;
    if (inside && /<\/style>/.test(trimmed)) {
      inside = false;
    }
  }

  return map;
};

// converts a source offset to a 1-based line/column position
export const offsetToPosition = (
  source: string,
  offset: number,
): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;

  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }

  return { line, column: offset - lineStart + 1 };
};
