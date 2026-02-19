import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { logger, highlighter, sanitize } from "../output/logger.js";
import { VERSION } from "../constants.js";

const HISTORY_DIR = ".svelte-doctor";
const HISTORY_FILE = "history.json";
const HISTORY_TMP = "history.json.tmp";
const MAX_ENTRIES = 500;
const CHART_HEIGHT = 10;
const MAX_BAR_COLUMNS = 60;

export interface ScoreEntry {
  timestamp: string;
  score: number;
  label: string;
  errors: number;
  warnings: number;
  filesScanned: number;
  filesAffected: number;
}

const getHistoryDir = (directory: string): string =>
  path.join(directory, HISTORY_DIR);

const getHistoryPath = (directory: string): string =>
  path.join(directory, HISTORY_DIR, HISTORY_FILE);

const getTmpPath = (directory: string): string =>
  path.join(directory, HISTORY_DIR, HISTORY_TMP);

const isValidEntry = (entry: unknown): entry is ScoreEntry => {
  if (typeof entry !== "object" || entry === null) return false;

  const e = entry as Record<string, unknown>;

  if (typeof e.timestamp !== "string") return false;
  if (typeof e.score !== "number") return false;
  if (typeof e.label !== "string") return false;
  if (typeof e.errors !== "number") return false;
  if (typeof e.warnings !== "number") return false;
  if (typeof e.filesScanned !== "number") return false;
  if (typeof e.filesAffected !== "number") return false;

  return true;
};

const ensureDirectory = (directory: string): void => {
  const dirPath = getHistoryDir(directory);

  try {
    const stat = fs.lstatSync(dirPath);
    // refuse to use symlinked directories
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) return;
  } catch {}

  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {}
};

export const loadScoreHistory = (directory: string): ScoreEntry[] => {
  const filePath = getHistoryPath(directory);

  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return [];

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
};

export const saveScoreHistory = (directory: string, entry: ScoreEntry): void => {
  try {
    ensureDirectory(directory);

    const dirPath = getHistoryDir(directory);
    const dirStat = fs.lstatSync(dirPath);
    if (dirStat.isSymbolicLink()) return;

    const history = loadScoreHistory(directory);
    history.push(entry);

    // trim oldest entries when exceeding the cap
    const trimmed = history.length > MAX_ENTRIES
      ? history.slice(history.length - MAX_ENTRIES)
      : history;

    const tmpPath = getTmpPath(directory);
    const finalPath = getHistoryPath(directory);

    fs.writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2), "utf-8");
    fs.renameSync(tmpPath, finalPath);
  } catch {}
};

const getBarColor = (score: number, bar: string): string => {
  if (score >= 75) return pc.green(bar);
  if (score >= 50) return pc.yellow(bar);
  return pc.red(bar);
};

const formatDateLabel = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  } catch {
    return "???";
  }
};

const getTrendArrow = (first: number, last: number): string => {
  const diff = last - first;
  if (diff > 2) return `↑ +${diff} from first run`;
  if (diff < -2) return `↓ ${diff} from first run`;
  return `→ stable`;
};

const getDaySpan = (entries: ScoreEntry[]): string => {
  try {
    const firstDate = new Date(entries[0].timestamp);
    const lastDate = new Date(entries[entries.length - 1].timestamp);
    const diffMs = lastDate.getTime() - firstDate.getTime();
    const days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    return `${days} day${days === 1 ? "" : "s"}`;
  } catch {
    return "unknown";
  }
};

export const printTrend = (directory: string, last: number): void => {
  const history = loadScoreHistory(directory);

  if (history.length === 0) {
    logger.break();
    logger.log(`  No score history found. Run ${highlighter.info("svelte-doctor check")} first.`);
    logger.break();
    return;
  }

  const entries = history.slice(-last);
  const maxScore = 100;
  const colWidth = Math.max(6, Math.min(8, Math.floor(MAX_BAR_COLUMNS / entries.length)));

  logger.break();
  logger.log(`  ${highlighter.bold("svelte-doctor trend")} v${VERSION}`);
  logger.break();
  logger.log(`  Score History (last ${entries.length} run${entries.length === 1 ? "" : "s"})`);
  logger.break();

  const step = maxScore / CHART_HEIGHT;

  for (let row = CHART_HEIGHT; row >= 1; row--) {
    const threshold = row * step;
    const labelVal = Math.round(threshold);
    const rowLabel = String(labelVal).padStart(5);

    let rowContent = "";

    for (let i = 0; i < entries.length; i++) {
      const normalizedScore = entries[i].score;
      const barChar = normalizedScore >= threshold ? "██" : "  ";
      const colored = normalizedScore >= threshold
        ? getBarColor(normalizedScore, barChar)
        : barChar;

      const padding = " ".repeat(colWidth - 2);
      rowContent += colored + padding;
    }

    logger.log(`  ${pc.dim(rowLabel)} ${pc.dim("┤")} ${rowContent}`);
  }

  const axisLine = "─".repeat(entries.length * colWidth + 2);
  logger.log(`  ${" ".repeat(5)} ${pc.dim(`└${axisLine}`)}`);

  let dateLabels = "  " + " ".repeat(6) + " ";
  for (let i = 0; i < entries.length; i++) {
    const label = formatDateLabel(entries[i].timestamp);
    const padded = label.padEnd(colWidth);
    dateLabels += padded;
  }
  logger.log(pc.dim(dateLabels));

  logger.break();

  const latest = entries[entries.length - 1];
  const first = entries[0];
  const trendArrow = getTrendArrow(first.score, latest.score);

  const scores = entries.map((e) => e.score);
  const bestScore = Math.max(...scores);
  const worstScore = Math.min(...scores);
  const bestEntry = entries.find((e) => e.score === bestScore)!;
  const worstEntry = entries.find((e) => e.score === worstScore)!;

  const latestScoreColored = getBarColor(latest.score, String(latest.score));
  const bestScoreColored = getBarColor(bestScore, String(bestScore));
  const worstScoreColored = getBarColor(worstScore, String(worstScore));

  logger.log(`  Latest: ${latestScoreColored} (${sanitize(latest.label)}) ${trendArrow}`);
  logger.log(`  Best:   ${bestScoreColored} (${sanitize(bestEntry.label)})  Worst: ${worstScoreColored} (${sanitize(worstEntry.label)})`);
  logger.log(`  Runs:   ${history.length} over ${getDaySpan(history)}`);
  logger.break();
};
