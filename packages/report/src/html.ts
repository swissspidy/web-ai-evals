import type { CellResult, RunFile } from '@web-ai-evals/core';
import type { RunDiff } from './diff.js';
import { cellStatus, esc, ms, modelLabel, num, pct, score, signed } from './format.js';

export interface ReportOptions {
  title?: string;
  /** Intro paragraph (plain text). */
  description?: string;
  /** Max examples shown per dataset in the example browser. Default 60. */
  maxExamples?: number;
}

/** Categorical slots from the dataviz reference palette (light, dark). Fixed order, never cycled. */
const SERIES = [
  ['#2a78d6', '#3987e5'],
  ['#eb6834', '#d95926'],
  ['#1baf7a', '#199e70'],
  ['#eda100', '#c98500'],
  ['#e87ba4', '#d55181'],
  ['#008300', '#008300'],
  ['#4a3aa7', '#9085e9'],
  ['#e34948', '#e66767'],
];

const CSS = `
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --good: #0ca30c; --good-text: #006300; --warning: #fab219; --critical: #d03b3b;
  ${SERIES.map(([l], i) => `--s${i + 1}: ${l};`).join(' ')}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10); --good-text: #0ca30c;
    ${SERIES.map(([, d], i) => `--s${i + 1}: ${d};`).join(' ')}
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10); --good-text: #0ca30c;
  ${SERIES.map(([, d], i) => `--s${i + 1}: ${d};`).join(' ')}
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; }
h2 { font-size: 21px; margin: 40px 0 8px; }
h3 { font-size: 16px; margin: 24px 0 8px; }
p, li { color: var(--ink-2); max-width: 75ch; }
code { font-size: 13px; }
.meta { color: var(--muted); font-size: 13px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin: 12px 0; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--grid); vertical-align: top; }
th { color: var(--ink-2); font-weight: 600; white-space: nowrap; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.key { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: baseline; }
.status { white-space: nowrap; }
.status::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--muted); }
.status.good::before { background: var(--good); } .status.warning::before { background: var(--warning); } .status.critical::before { background: var(--critical); }
.why { color: var(--muted); font-size: 12px; display: block; max-width: 40ch; }
details > summary { cursor: pointer; color: var(--ink-2); margin: 8px 0; }
.out { max-width: 36ch; white-space: pre-wrap; word-break: break-word; }
.sc { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 12px; }
.chart { width: 100%; height: auto; display: block; }
.chart text { fill: var(--muted); font-size: 12px; }
.chart .lbl { fill: var(--ink-2); font-size: 12px; }
.chart .gridline { stroke: var(--grid); stroke-width: 1; }
.chart .axis { stroke: var(--axis); stroke-width: 1; }
.chart .pt { stroke: var(--surface); stroke-width: 2; }
.chart .hit { fill: transparent; cursor: default; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; color: var(--ink-2); margin: 4px 0 8px; padding: 0; list-style: none; }
#tip { position: fixed; pointer-events: none; background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.12); display: none; max-width: 320px; z-index: 10; }
#tip strong { font-size: 14px; }
.flag { color: var(--critical); }
.up { color: var(--good-text); }
`;

const TOOLTIP_JS = `
(() => {
  const tip = document.getElementById('tip');
  const show = (el, x, y) => {
    tip.replaceChildren();
    const lines = JSON.parse(el.dataset.tip);
    lines.forEach((line, i) => {
      const row = document.createElement(i === 0 ? 'strong' : 'div');
      row.textContent = line;
      tip.appendChild(row);
      if (i === 0) tip.appendChild(document.createElement('br'));
    });
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(x + 12, innerWidth - r.width - 8) + 'px';
    tip.style.top = Math.max(8, y - r.height - 12) + 'px';
  };
  document.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('pointermove', (e) => show(el, e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => (tip.style.display = 'none'));
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.right, r.top); });
    el.addEventListener('blur', () => (tip.style.display = 'none'));
  });
})();
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
<div id="tip" role="status"></div>
<script>${TOOLTIP_JS}</script>
</body>
</html>`;
}

/** Stable label for a cell across merged runs. */
function cellLabel(cell: CellResult, multiBrowser: boolean): string {
  return multiBrowser ? `${cell.backend.id} · ${cell.environment.browser.id}` : cell.backend.id;
}

interface Series {
  label: string;
  color: number;
}

function assignColors(cells: CellResult[], multiBrowser: boolean): Map<string, Series> {
  // Color follows the backend id (entity), in first-seen order, never re-assigned per chart.
  const order: string[] = [];
  for (const c of cells) if (!order.includes(c.backend.id)) order.push(c.backend.id);
  const map = new Map<string, Series>();
  for (const c of cells) {
    map.set(c.key, { label: cellLabel(c, multiBrowser), color: Math.min(order.indexOf(c.backend.id), SERIES.length - 1) + 1 });
  }
  return map;
}

function latencyOf(cell: CellResult): number | undefined {
  return cell.summary.warm?.totalMs?.p50 ?? cell.summary.totalMs?.p50;
}

function scatter(cells: CellResult[], colors: Map<string, Series>, primary: string): string {
  const pts = cells
    .map((c) => ({ c, x: latencyOf(c), y: c.summary.scores[primary] }))
    .filter((p): p is { c: CellResult; x: number; y: number } => p.x !== undefined && p.x > 0 && p.y !== undefined);
  if (!pts.length) return '<p class="meta">No backend produced results for this dataset, so there is nothing to plot.</p>';
  const W = 760, H = 340, L = 56, R = 150, T = 16, B = 44;
  const xs = pts.map((p) => p.x);
  let lo = Math.floor(Math.log10(Math.min(...xs)));
  let hi = Math.ceil(Math.log10(Math.max(...xs)));
  if (hi === lo) hi = lo + 1;
  const X = (v: number) => L + ((Math.log10(v) - lo) / (hi - lo)) * (W - L - R);
  const Y = (v: number) => T + (1 - v) * (H - T - B);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Quality (${esc(primary)}) against median latency per backend">`;
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    svg += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(2)}</text>`;
  }
  for (let e = lo; e <= hi; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (Math.log10(v) > hi) continue;
      const x = X(v);
      svg += `<line class="axis" x1="${x}" x2="${x}" y1="${H - B}" y2="${H - B + 4}"/><text x="${x}" y="${H - B + 18}" text-anchor="middle">${esc(ms(v))}</text>`;
    }
  }
  svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  svg += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">median latency per example (warm, log scale) →</text>`;
  svg += `<text x="14" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">${esc(primary)} ↑</text>`;

  // Direct labels to the right of each point, nudged apart vertically.
  const labels = pts.map((p) => ({ p, x: X(p.x), y: Y(p.y), ly: Y(p.y) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].ly - labels[i - 1].ly < 14) labels[i].ly = labels[i - 1].ly + 14;
  for (const l of labels) {
    const s = colors.get(l.p.c.key)!;
    const tip = [
      `${primary} ${score(l.p.y)}`,
      s.label,
      modelLabel(l.p.c),
      `median latency ${ms(l.p.x)}`,
      `TTFT p50 ${ms(l.p.c.summary.ttftMs?.p50)}`,
      `tokens/s p50 ${num(l.p.c.summary.tokensPerSecond?.p50)}`,
      `${l.p.c.summary.ok}/${l.p.c.summary.total} ok`,
    ];
    svg += `<circle class="pt" cx="${l.x}" cy="${l.y}" r="6" fill="var(--s${s.color})"/>`;
    svg += `<text class="lbl" x="${l.x + 10}" y="${l.ly + 4}">${esc(s.label)}</text>`;
    svg += `<circle class="hit" cx="${l.x}" cy="${l.y}" r="14" tabindex="0" data-tip="${esc(JSON.stringify(tip))}"/>`;
  }
  svg += '</svg>';
  const legend = `<ul class="legend">${[...new Map(pts.map((p) => [p.c.key, colors.get(p.c.key)!])).values()]
    .map((s) => `<li><span class="key" style="background:var(--s${s.color})"></span>${esc(s.label)}</li>`)
    .join('')}</ul>`;
  return legend + svg;
}

function summaryTable(cells: CellResult[], colors: Map<string, Series>): string {
  const scorers = [...new Set(cells.flatMap((c) => c.scorers))];
  const aggregates = [...new Set(cells.flatMap((c) => Object.keys(c.summary.aggregates)))].filter((k) => !k.includes('.f1:'));
  const head = [
    '<th>Backend</th><th>Model</th><th>Browser</th><th>Status</th>',
    ...scorers.map((s) => `<th class="n">${esc(s)}</th>`),
    ...aggregates.map((a) => `<th class="n">${esc(a)}</th>`),
    '<th class="n">TTFT p50</th><th class="n">Latency p50</th><th class="n">Latency p95</th><th class="n">Tokens/s p50</th><th class="n">Load</th>',
  ].join('');
  const rows = cells.map((c) => {
    const s = colors.get(c.key)!;
    const st = cellStatus(c);
    const why = c.load.status !== 'ok' && c.load.error ? `<span class="why">${esc(c.load.error)}</span>` : '';
    const load = c.load.loadMs !== undefined ? `${ms(c.load.loadMs)}${c.load.downloaded ? ' (download)' : ''}` : '—';
    const tpsSource = c.results.find((r) => r.timings.tokenCountSource)?.timings.tokenCountSource;
    return `<tr>
<td><span class="key" style="background:var(--s${s.color})"></span>${esc(c.backend.id)}</td>
<td>${esc(modelLabel(c))}${c.environment.backend.modelVersion ? `<span class="why">version ${esc(c.environment.backend.modelVersion)}</span>` : ''}</td>
<td>${esc(c.environment.browser.id)} ${esc(c.environment.browser.version)}</td>
<td><span class="status ${st.kind}">${esc(st.label)}</span>${why}</td>
${scorers.map((k) => `<td class="n">${score(c.summary.scores[k])}</td>`).join('')}
${aggregates.map((k) => `<td class="n">${score(c.summary.aggregates[k])}</td>`).join('')}
<td class="n">${ms(c.summary.ttftMs?.p50)}</td>
<td class="n">${ms(latencyOf(c))}</td>
<td class="n">${ms(c.summary.totalMs?.p95)}</td>
<td class="n" title="token counts: ${esc(tpsSource ?? 'n/a')}">${num(c.summary.tokensPerSecond?.p50)}</td>
<td class="n">${load}</td>
</tr>`;
  });
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function examplesTable(cells: CellResult[], colors: Map<string, Series>, primary: string, max: number): string {
  const ran = cells.filter((c) => c.summary.ok > 0);
  if (!ran.length) return '';
  const ids: string[] = [];
  for (const c of ran) for (const r of c.results) if (r.repeat === 1 && !ids.includes(r.exampleId)) ids.push(r.exampleId);
  const shown = ids.slice(0, max);
  const lookup = new Map(ran.map((c) => [c.key, new Map(c.results.filter((r) => r.repeat === 1).map((r) => [r.exampleId, r]))]));
  const head = `<th>Example</th>${ran.map((c) => `<th><span class="key" style="background:var(--s${colors.get(c.key)!.color})"></span>${esc(colors.get(c.key)!.label)}</th>`).join('')}`;
  const rows = shown.map((id) => {
    const cellsHtml = ran
      .map((c) => {
        const r = lookup.get(c.key)!.get(id);
        if (!r) return '<td>—</td>';
        if (r.status !== 'ok') return `<td><span class="status critical">${esc(r.status)}</span><span class="why">${esc(r.error ?? '')}</span></td>`;
        const out = r.output ?? '';
        const short = out.length > 220 ? `${out.slice(0, 220)}…` : out;
        return `<td><div class="out" title="${esc(out)}">${esc(short)}</div><span class="sc">${esc(primary)} ${score(r.scores[primary])} · ${ms(r.timings.totalMs)}</span></td>`;
      })
      .join('');
    return `<tr><td><code>${esc(id)}</code></td>${cellsHtml}</tr>`;
  });
  return `<details><summary>Outputs for ${shown.length} of ${ids.length} examples</summary><div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}

function environmentTable(cells: CellResult[]): string {
  const rows = cells.map((c) => {
    const e = c.environment;
    const gpu = e.gpu ? [e.gpu.vendor, e.gpu.architecture, e.gpu.description].filter(Boolean).join(' · ') + (e.gpu.isFallbackAdapter ? ' (fallback)' : '') : 'no WebGPU adapter';
    const comps = e.backend.details?.builtInComponents as Record<string, string> | undefined;
    return `<tr>
<td>${esc(c.key)}</td>
<td>${esc(e.browser.name)} ${esc(e.browser.version)}<span class="why">${esc(e.browser.channel ?? '')}${e.browser.headless ? ', headless' : ', headful'}</span></td>
<td>${esc(e.os.platform)} ${esc(e.os.release)} ${esc(e.os.arch)}</td>
<td>${esc(e.hardware.cpuModel ?? '')}<span class="why">${e.hardware.cores} cores${e.hardware.memoryBytes ? `, ${(e.hardware.memoryBytes / 2 ** 30).toFixed(0)} GiB` : ''}</span></td>
<td>${esc(gpu)}</td>
<td>${esc(e.backend.kind)}${e.backend.modelVersion ? ` ${esc(e.backend.modelVersion)}` : ''}${comps ? `<span class="why">${esc(Object.entries(comps).map(([k, v]) => `${k}: ${v}`).join(', '))}</span>` : ''}</td>
<td><details><summary>${e.flags.length} args</summary><code>${esc(e.flags.join(' '))}</code></details></td>
</tr>`;
  });
  return `<div class="scroll"><table><thead><tr><th>Cell</th><th>Browser</th><th>OS</th><th>CPU</th><th>GPU (WebGPU adapter)</th><th>Backend</th><th>Flags</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

/** Render one or more runs (e.g. from different machines) as one self-contained HTML report. */
export function renderReport(runs: RunFile[], options: ReportOptions = {}): string {
  const cells = runs.flatMap((r) => r.cells);
  const title = options.title ?? runs[0]?.name ?? 'web-ai-evals report';
  const multiBrowser = new Set(cells.map((c) => c.environment.browser.id)).size > 1;
  const colors = assignColors(cells, multiBrowser);
  const datasets = [...new Set(cells.map((c) => c.dataset.id))];
  let body = `<h1>${esc(title)}</h1>
<p class="meta">${runs.map((r) => `run <code>${esc(r.runId)}</code> · ${esc(r.startedAt.slice(0, 16).replace('T', ' '))} UTC · ${esc(r.host.platform)} ${esc(r.host.cpuModel ?? '')}`).join('<br>')}</p>`;
  if (options.description) body += `<p>${esc(options.description)}</p>`;
  const notes = runs.flatMap((r) => r.notes ?? []);
  if (notes.length) body += `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;

  for (const id of datasets) {
    const dc = cells.filter((c) => c.dataset.id === id);
    const primary = dc[0].scorers[0];
    const d = dc[0].dataset;
    body += `<h2>${esc(id)}</h2>
<p class="meta">task <code>${esc(dc[0].task.type)}</code> · ${d.examples} examples · primary metric <code>${esc(primary)}</code>${d.license ? ` · data license ${esc(d.license)}` : ''} · sha256 ${esc(d.sha256.slice(0, 12))}</p>
<div class="card">${scatter(dc, colors, primary)}</div>
<div class="card">${summaryTable(dc, colors)}
<p class="meta">Scores are means over all examples; errors and timeouts count as 0. Latency is the median wall time per example after the first (warm). TTFT is the time to the first streamed text. Tokens/s is decode throughput after the first token; hover the column for how tokens were counted.</p></div>
${examplesTable(dc, colors, primary, options.maxExamples ?? 60)}`;
  }
  body += `<h2>Environment</h2>${environmentTable(cells)}`;
  body += `<p class="meta">Generated by ${esc(runs[0]?.tool.name ?? 'web-ai-evals')} ${esc(runs[0]?.tool.version ?? '')}.</p>`;
  return page(title, body);
}

/** Render a run diff (e.g. yesterday's nightly vs today's, or Chrome Stable vs Canary). */
export function renderDiff(diff: RunDiff, options: { title?: string } = {}): string {
  const title = options.title ?? 'web-ai-evals diff';
  let body = `<h1>${esc(title)}</h1>
<p class="meta">before <code>${esc(diff.before.runId)}</code> (${esc(diff.before.startedAt.slice(0, 16))}) → after <code>${esc(diff.after.runId)}</code> (${esc(diff.after.startedAt.slice(0, 16))})</p>`;
  body += diff.flags.length
    ? `<div class="card"><h3 class="flag">${diff.flags.length} change${diff.flags.length === 1 ? '' : 's'} need attention</h3><ul>${diff.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>`
    : '<div class="card"><h3>No flagged changes</h3></div>';
  for (const c of diff.cells) {
    body += `<h2>${esc(c.key)}</h2>`;
    if (c.envChanges.length) {
      body += `<h3>Environment</h3><div class="scroll"><table><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${c.envChanges
        .map((e) => `<tr><td>${esc(e.field)}</td><td><code>${esc(JSON.stringify(e.before))}</code></td><td><code>${esc(JSON.stringify(e.after))}</code></td></tr>`)
        .join('')}</tbody></table></div>`;
    }
    body += `<h3>Metrics</h3><div class="scroll"><table><thead><tr><th>Metric</th><th class="n">Before</th><th class="n">After</th><th class="n">Change</th></tr></thead><tbody>
${c.scores.map((s) => `<tr><td>${esc(s.metric)}</td><td class="n">${score(s.before)}</td><td class="n">${score(s.after)}</td><td class="n ${s.flagged ? (s.delta < 0 ? 'flag' : 'up') : ''}">${signed(s.delta)}</td></tr>`).join('')}
${c.latency.map((l) => `<tr><td>${esc(l.metric)}</td><td class="n">${l.metric.startsWith('tokens') ? num(l.before) : ms(l.before)}</td><td class="n">${l.metric.startsWith('tokens') ? num(l.after) : ms(l.after)}</td><td class="n ${l.flagged ? 'flag' : ''}">${l.ratio ? `×${l.ratio.toFixed(2)}` : '—'}</td></tr>`).join('')}
</tbody></table></div>`;
    if (c.changedOutputs.length) {
      body += `<details><summary>${c.changedOutputs.length} of ${c.after.summary.total} outputs changed (${pct(c.changedOutputs.length / Math.max(1, c.after.summary.total))})</summary><div class="scroll"><table><thead><tr><th>Example</th><th>Before</th><th>After</th></tr></thead><tbody>${c.changedOutputs
        .slice(0, 100)
        .map((o) => `<tr><td><code>${esc(o.exampleId)}</code></td><td class="out">${esc(o.before ?? '')}</td><td class="out">${esc(o.after ?? '')}</td></tr>`)
        .join('')}</tbody></table></div></details>`;
    }
  }
  if (diff.onlyBefore.length || diff.onlyAfter.length) {
    body += `<h2>Unmatched cells</h2><p>Only before: ${esc(diff.onlyBefore.join(', ') || 'none')}<br>Only after: ${esc(diff.onlyAfter.join(', ') || 'none')}</p>`;
  }
  return page(title, body);
}
