import type { Diagnostic, ProjectInfo, ScanMeta, ScoreHistoryEntry, ScoreResult } from "../types.js";

const escapeHtml = (value: string): string => {
  let output = "";

  for (const char of value) {
    if (char === "&") output += "&amp;";
    if (char === "<") output += "&lt;";
    if (char === ">") output += "&gt;";
    if (char === '"') output += "&quot;";
    if (char === "'") output += "&#39;";
    if (char !== "&" && char !== "<" && char !== ">" && char !== '"' && char !== "'") output += char;
  }

  return output;
};

const getHeatLevel = (count: number, max: number): "low" | "medium" | "high" => {
  if (max === 0) return "low";
  const ratio = count / max;
  if (ratio > 0.66) return "high";
  if (ratio > 0.33) return "medium";
  return "low";
};

const categoryBars = (score: ScoreResult): string =>
  Object.entries(score.categoryBreakdown).map(([category, entry]) => {
    const width = Math.min(100, Math.max(4, entry.count * 8));
    return `<div class="bar-row"><span>${escapeHtml(category)}</span><div class="bar"><i style="width:${width}%"></i></div><b>${entry.count}</b></div>`;
  }).join("");

const fileHeatmap = (diagnostics: Diagnostic[]): string => {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) counts.set(diagnostic.filePath, (counts.get(diagnostic.filePath) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([filePath, count]) =>
    `<div class="heat-item heat-${getHeatLevel(count, max)}"><span>${escapeHtml(filePath)}</span><b>${count}</b></div>`,
  ).join("");
};

const trendPoints = (history: ScoreHistoryEntry[]): string => {
  const entries = history.slice(-20);
  if (entries.length === 0) return "";
  return entries.map((entry, index) => {
    const x = entries.length === 1 ? 0 : (index / (entries.length - 1)) * 100;
    const y = 100 - Math.max(0, Math.min(100, entry.score));
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
};

export const buildHtmlReport = (
  diagnostics: Diagnostic[],
  meta: ScanMeta,
  project: ProjectInfo,
  score: ScoreResult,
  history: ScoreHistoryEntry[],
): string => {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const rows = diagnostics.map((diagnostic) => `
    <tr data-category="${escapeHtml(diagnostic.category)}" data-severity="${diagnostic.severity}" data-file="${escapeHtml(diagnostic.filePath)}">
      <td>${escapeHtml(diagnostic.rule)}</td><td><span class="pill ${diagnostic.severity}">${diagnostic.severity}</span></td><td>${escapeHtml(diagnostic.category)}</td>
      <td>${escapeHtml(diagnostic.filePath)}:${diagnostic.line}:${diagnostic.column}</td><td>${escapeHtml(diagnostic.message)}</td><td>${diagnostic.fixable ? "✓" : ""}</td>
    </tr>`).join("");
  const categoryOptions = Array.from(new Set(diagnostics.map((diagnostic) => diagnostic.category))).sort().map((category) => `<option>${escapeHtml(category)}</option>`).join("");
  const fileOptions = Array.from(new Set(diagnostics.map((diagnostic) => diagnostic.filePath))).sort().map((filePath) => `<option>${escapeHtml(filePath)}</option>`).join("");
  const points = trendPoints(history);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>svelte-doctor report</title>
<style>
:root{color-scheme:dark light;--bg:#0f172a;--panel:#111827;--text:#e5e7eb;--muted:#94a3b8;--border:#334155;--ok:#22c55e;--warn:#f59e0b;--err:#ef4444}body{margin:0;font-family:Inter,ui-sans-serif,system-ui;background:var(--bg);color:var(--text)}main{max-width:1180px;margin:auto;padding:32px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}.card,.panel{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:18px}.score{font-size:48px;font-weight:800}.muted{color:var(--muted)}.pill{border-radius:999px;padding:3px 8px;font-size:12px}.pill.error{background:color-mix(in srgb,var(--err) 30%,transparent);color:#fecaca}.pill.warning{background:color-mix(in srgb,var(--warn) 30%,transparent);color:#fde68a}.bar-row{display:grid;grid-template-columns:190px 1fr 40px;gap:10px;align-items:center;margin:10px 0}.bar{height:10px;background:#1f2937;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--ok),var(--warn),var(--err))}.heat-item{display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border)}.heat-low{border-left:8px solid var(--ok)}.heat-medium{border-left:8px solid var(--warn)}.heat-high{border-left:8px solid var(--err)}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid var(--border);padding:10px;text-align:left}th{cursor:pointer}select,input{background:#020617;color:var(--text);border:1px solid var(--border);border-radius:10px;padding:9px}details{margin-top:18px}.filters{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}@media (prefers-color-scheme:light){:root{--bg:#f8fafc;--panel:#fff;--text:#0f172a;--muted:#64748b;--border:#cbd5e1}select,input{background:#fff}}</style>
</head>
<body><main>
<header><h1>svelte-doctor Report</h1><p class="muted">${escapeHtml(project.projectName)} · ${escapeHtml(project.framework)} · Svelte ${escapeHtml(project.svelteVersion ?? "unknown")}</p></header>
<section class="grid"><div class="card"><div class="muted">Score</div><div class="score">${score.score}</div><div>${escapeHtml(score.label)}</div></div><div class="card"><div class="muted">Files</div><h2>${meta.totalFiles}</h2></div><div class="card"><div class="muted">Affected</div><h2>${meta.affectedFiles}</h2></div><div class="card"><div class="muted">Errors</div><h2>${errors}</h2></div><div class="card"><div class="muted">Warnings</div><h2>${warnings}</h2></div><div class="card"><div class="muted">Fixable</div><h2>${meta.fixableCount}</h2></div></section>
<section class="panel"><h2>Category Breakdown</h2>${categoryBars(score)}</section>
<section class="panel"><h2>Score Trend</h2><svg viewBox="0 0 100 100" width="100%" height="160" preserveAspectRatio="none"><polyline fill="none" stroke="#38bdf8" stroke-width="2" points="${points}"></polyline></svg></section>
<section class="panel"><h2>File Heatmap</h2>${fileHeatmap(diagnostics) || "<p class='muted'>No affected files.</p>"}</section>
<section class="panel"><h2>Diagnostics</h2><div class="filters"><input id="q" placeholder="Search"><select id="severity"><option value="">All severities</option><option>error</option><option>warning</option></select><select id="category"><option value="">All categories</option>${categoryOptions}</select><select id="file"><option value="">All files</option>${fileOptions}</select></div><table id="diagnostics"><thead><tr><th>Rule</th><th>Severity</th><th>Category</th><th>Location</th><th>Message</th><th>Fixable</th></tr></thead><tbody>${rows}</tbody></table></section>
</main><script>
const q=document.querySelector('#q'),sev=document.querySelector('#severity'),cat=document.querySelector('#category'),file=document.querySelector('#file');
function apply(){const query=q.value.toLowerCase();for(const row of document.querySelectorAll('#diagnostics tbody tr')){const ok=(!sev.value||row.dataset.severity===sev.value)&&(!cat.value||row.dataset.category===cat.value)&&(!file.value||row.dataset.file===file.value)&&(!query||row.textContent.toLowerCase().includes(query));row.style.display=ok?'':'none'}}
[q,sev,cat,file].forEach(el=>el.addEventListener('input',apply));
for(const th of document.querySelectorAll('th'))th.addEventListener('click',()=>{const table=th.closest('table'),idx=[...th.parentNode.children].indexOf(th);[...table.tBodies[0].rows].sort((a,b)=>a.cells[idx].textContent.localeCompare(b.cells[idx].textContent)).forEach(row=>table.tBodies[0].appendChild(row))});
</script></body></html>`;
};
