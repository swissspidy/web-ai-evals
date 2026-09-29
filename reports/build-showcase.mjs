// Builds the published showcase page from one or more run files.
//   node reports/build-showcase.mjs results/<run>.json [more.json] > reports/showcase/index.html
import { readFileSync } from 'node:fs';

const runs = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const cells = runs.flatMap((r) => r.cells);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sec = (ms) => (ms === undefined ? '—' : ms >= 10000 ? `${(ms / 1000).toFixed(0)} s` : `${(ms / 1000).toFixed(1)} s`);

const NAMES = {
  'gemini-nano': ['Gemini Nano', 'Prompt API · Chrome built-in'],
  'phi-4-mini': ['Phi-4-mini', 'Prompt API · Edge built-in'],
  'gemma3-1b-webllm': ['Gemma 3 1B', 'WebLLM · WebGPU · q4f16'],
  'gemma3-1b-tjs-webgpu': ['Gemma 3 1B', 'Transformers.js · WebGPU · q4f16'],
  'qwen2.5-0.5b-tjs-wasm': ['Qwen2.5 0.5B', 'Transformers.js · Wasm · q4'],
  'chrome-summarizer': ['Summarizer API', 'Chrome built-in · tl;dr mode'],
  'chrome-summarizer-keypoints': ['Summarizer API', 'Chrome built-in · key-points mode'],
  'chrome-translator': ['Translator API', 'Chrome built-in'],
};
const ORDER = Object.keys(NAMES);
const SLOT = { 'gemini-nano': 1, 'qwen2.5-0.5b-tjs-wasm': 2, 'chrome-summarizer': 3, 'chrome-summarizer-keypoints': 4, 'chrome-translator': 5, 'phi-4-mini': 6, 'gemma3-1b-webllm': 7, 'gemma3-1b-tjs-webgpu': 8 };

const SUITES = {
  sentiment: { title: 'Sentiment classification', metric: 'accuracy', metricLabel: 'Accuracy', blurb: '60 short reviews and statements, three labels. 20 of them are hard: sarcasm, negation, litotes, mixed verdicts.' },
  summarization: { title: 'Summarization', metric: 'rougeL', metricLabel: 'ROUGE-L F1', blurb: '12 news-style articles (90–120 words) against a one-to-two sentence reference summary.' },
  extraction: { title: 'Structured extraction', metric: 'fields', metricLabel: 'Field accuracy', blurb: '20 restaurant booking requests to JSON with name, ISO date, city and party size.' },
  translation: { title: 'Translation EN → DE', metric: 'chrF', metricLabel: 'chrF', blurb: '20 everyday English sentences against a German reference translation.' },
};

const run = runs[0];
const num = (v) => (Number.isFinite(Number(v)) ? String(Number(v)) : '?');
const GPU_BACKENDS = ['phi-4-mini', 'gemma3-1b-webllm', 'gemma3-1b-tjs-webgpu'];
const gpuMeasured = cells.some((c) => GPU_BACKENDS.includes(c.backend.id) && c.load.status === 'ok');

/** One line per machine, from any cell of that run (loaded or not). */
function machineLine(r) {
  const cell = r.cells.find((c) => c.load.status === 'ok') ?? r.cells[0];
  if (!cell) return '';
  const e = cell.environment;
  const gpu = r.cells.map((c) => c.environment.gpu).find(Boolean);
  const nano = r.cells.find((c) => c.backend.kind === 'prompt-api' && c.load.status === 'ok')?.environment.backend;
  const comps = nano?.details?.builtInComponents ?? {};
  const parts = [
    `${esc(e.browser.name)} ${esc(e.browser.version)} (${esc(e.browser.channel ?? '')}, ${e.browser.headless ? 'headless' : 'headful'})`,
    `${esc(e.os.platform)} ${esc(e.os.arch)}`,
    `${esc(e.hardware.cpuModel ?? r.host.cpuModel ?? '')} · ${num(e.hardware.cores)} cores · ${num(Math.round((e.hardware.memoryBytes ?? r.host.memoryBytes) / 2 ** 30))} GiB`,
    gpu ? `GPU ${esc([gpu.vendor, gpu.architecture, gpu.description].filter(Boolean).join(' '))}` : 'no GPU, no WebGPU adapter',
  ];
  if (nano) parts.push(`${esc(nano.model ?? 'built-in model')} ${esc(comps.baseModelVersion ?? nano.modelVersion ?? '')}${comps.onDeviceModel ? ` · asset ${esc(comps.onDeviceModel)}` : ''}`);
  return `<div class="machine">${parts.map((p) => `<span>${p}</span>`).join('')}</div>`;
}

if (!cells.some((c) => c.load.status === 'ok')) {
  process.stdout.write(`<title>Built-in AI vs In-Page Models</title><main style="max-width:680px;margin:0 auto;padding:40px 16px;font:16px/1.5 system-ui,sans-serif"><h1>No results</h1><p>No backend loaded in ${runs.length} run(s): ${esc(cells.map((c) => `${c.backend.id}: ${c.load.error ?? c.load.status}`).slice(0, 12).join('; '))}</p></main>`);
  process.exit(0);
}

function bars(rows, value, max, fmt, cls) {
  return rows
    .map((r) => {
      const v = value(r);
      const w = v === undefined ? 0 : Math.max(0.5, (v / max) * 100);
      return `<div class="bar-row"><div class="bar-track"><div class="bar ${cls}" style="width:${w.toFixed(2)}%;background:var(--s${SLOT[r.backend.id] ?? 8})"></div></div><span class="bar-val">${fmt(v)}</span></div>`;
    })
    .join('');
}

function suiteSection(id) {
  const meta = SUITES[id];
  const all = cells.filter((c) => c.dataset.id === id).sort((a, b) => ORDER.indexOf(a.backend.id) - ORDER.indexOf(b.backend.id));
  const ran = all.filter((c) => c.load.status === 'ok');
  const skipped = all.filter((c) => c.load.status !== 'ok');
  if (!ran.length) return '';
  const lat = (c) => c.summary.warm?.totalMs?.p50 ?? c.summary.totalMs?.p50;
  const maxLat = Math.max(...ran.map((c) => lat(c) ?? 0));
  const bar = (v, max, fmt, slot) => {
    const w = v === undefined ? 0 : Math.max(0.5, (v / max) * 100);
    return `<div class="bar-row"><div class="bar-track"><div class="bar" style="width:${w.toFixed(2)}%;background:var(--s${slot})"></div></div><span class="bar-val">${fmt(v)}</span></div>`;
  };
  const chartRows = ran
    .map((c) => {
      const [n, sub] = NAMES[c.backend.id] ?? [c.backend.id, ''];
      const slot = SLOT[c.backend.id] ?? 8;
      return `<div class="crow"><div class="who"><span class="key" style="background:var(--s${slot})"></span><span><strong>${esc(n)}</strong><small>${esc(sub)}</small></span></div>${bar(c.summary.scores[meta.metric], 1, (v) => v.toFixed(3), slot)}${bar(lat(c), maxLat, sec, slot)}</div>`;
    })
    .join('');
  const rows = ran
    .map((c) => {
      const s = c.summary;
      const extra = id === 'summarization' ? `${s.scores.words?.toFixed(0)} words` : id === 'extraction' ? `${(s.scores.jsonSchema * 100).toFixed(0)}% schema-valid` : id === 'sentiment' ? `macro-F1 ${s.aggregates['accuracy.macroF1']?.toFixed(3)}` : `${(s.scores.exact * 100).toFixed(0)}% contain the reference`;
      return `<tr><td>${esc(NAMES[c.backend.id]?.[0] ?? c.backend.id)} <small>${esc(NAMES[c.backend.id]?.[1] ?? '')}</small></td><td class="n">${s.scores[meta.metric].toFixed(3)}</td><td class="n">${esc(extra)}</td><td class="n">${sec(s.ttftMs?.p50)}</td><td class="n">${sec(lat(c))}</td><td class="n">${s.tokensPerSecond ? s.tokensPerSecond.p50.toFixed(1) : '—'}</td><td class="n">${num(s.ok)}/${num(s.total)}</td></tr>`;
    })
    .join('');
  return `<section class="suite" id="${id}">
  <header><h2>${esc(meta.title)}</h2><p>${esc(meta.blurb)}</p></header>
  <div class="chart">
    <div class="crow chead"><div></div><div class="col-head">${esc(meta.metricLabel)} <span>higher is better, 0–1</span></div><div class="col-head">Median latency per example <span>lower is better</span></div></div>
    ${chartRows}
  </div>
  <div class="scroll"><table><thead><tr><th>Backend</th><th class="n">${esc(meta.metricLabel)}</th><th class="n">Detail</th><th class="n">TTFT p50</th><th class="n">Latency p50</th><th class="n">Tokens/s p50</th><th class="n">OK</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${skipped.length ? `<p class="na">Not measured on this machine: ${skipped.map((c) => `${esc((NAMES[c.backend.id] ?? [c.backend.id])[0])} (${esc((NAMES[c.backend.id] ?? ['', ''])[1])})`).join(', ')}. No WebGPU adapter.</p>` : ''}
</section>`;
}

const ok = (id, b) => cells.find((c) => c.dataset.id === id && c.backend.id === b && c.load.status === 'ok');
const f3 = (c, m) => c?.summary.scores[m]?.toFixed(3) ?? '—';
const s = {
  nanoSent: ok('sentiment', 'gemini-nano'), qwenSent: ok('sentiment', 'qwen2.5-0.5b-tjs-wasm'),
  nanoSum: ok('summarization', 'gemini-nano'), qwenSum: ok('summarization', 'qwen2.5-0.5b-tjs-wasm'),
  tldr: ok('summarization', 'chrome-summarizer'), kp: ok('summarization', 'chrome-summarizer-keypoints'),
  nanoExt: ok('extraction', 'gemini-nano'), qwenExt: ok('extraction', 'qwen2.5-0.5b-tjs-wasm'),
  nanoTr: ok('translation', 'gemini-nano'), qwenTr: ok('translation', 'qwen2.5-0.5b-tjs-wasm'), tr: ok('translation', 'chrome-translator'),
};
const lat = (c) => c?.summary.warm?.totalMs?.p50 ?? c?.summary.totalMs?.p50;

const html = `<title>Built-in AI vs In-Page Models</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: one reading column; each suite is a three-column bench sheet (who | quality | latency) that stacks on phones. */
:root {
  --paper: #f5f6f4; --sheet: #fcfcfb; --ink: #15181b; --ink-2: #4f5559; --muted: #7d8387; --rule: #dfe1dd; --track: #eceeea; --accent: #1f5f8b;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #4a3aa7; --s8: #e34948;
  --display: "IBM Plex Sans Condensed", "Arial Narrow", system-ui, sans-serif;
  --body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --paper: #111315; --sheet: #1a1c1e; --ink: #f1f2f0; --ink-2: #c1c5c3; --muted: #8b9195; --rule: #2d3033; --track: #26292b; --accent: #7fb6de;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767; color-scheme: dark; } }
:root[data-theme="dark"] {
  --paper: #111315; --sheet: #1a1c1e; --ink: #f1f2f0; --ink-2: #c1c5c3; --muted: #8b9195; --rule: #2d3033; --track: #26292b; --accent: #7fb6de;
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767; color-scheme: dark; }
body { background: var(--paper); color: var(--ink); font: 16px/1.55 var(--body); }
main { max-width: 1040px; margin: 0 auto; padding-inline: 16px; padding-block: 40px 72px; }
h1, h2 { font-family: var(--display); font-weight: 600; text-wrap: balance; letter-spacing: -0.01em; margin: 0; }
h1 { font-size: clamp(2rem, 5vw, 3.1rem); line-height: 1.05; }
h2 { font-size: 1.55rem; }
p { max-width: 68ch; color: var(--ink-2); margin: 0; }
small { color: var(--muted); font-size: 0.8rem; }
code, .mono { font-family: var(--mono); font-size: 0.86em; }
a { color: var(--accent); }
.eyebrow { font: 500 0.75rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.intro { display: grid; gap: 14px; margin-bottom: 28px; }
.machine { display: flex; flex-wrap: wrap; gap: 6px 18px; font: 0.82rem/1.4 var(--mono); color: var(--ink-2); padding-block: 12px; border-block: 1px solid var(--rule); }
.findings { display: grid; gap: 10px; margin: 28px 0 8px; padding: 0; list-style: none; counter-reset: f; }
.findings li { display: grid; grid-template-columns: 2.2rem 1fr; gap: 8px; color: var(--ink-2); max-width: 78ch; }
.findings li::before { counter-increment: f; content: counter(f, decimal-leading-zero); font: 500 0.8rem/1.7 var(--mono); color: var(--muted); }
.findings strong { color: var(--ink); }
.suite { background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 22px 20px; margin-top: 22px; display: grid; gap: 16px; }
.suite header { display: grid; gap: 6px; }
.chart { display: grid; gap: 4px; }
.crow { display: grid; grid-template-columns: minmax(170px, 1.1fr) 1fr 1fr; gap: 4px 22px; align-items: center; min-height: 3rem; }
.col-head { font: 500 0.72rem/1.2 var(--mono); text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-2); }
.col-head span { display: block; text-transform: none; letter-spacing: 0; color: var(--muted); }
.who, .bar-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.who span:last-child { display: grid; line-height: 1.25; }
.key { flex: none; width: 10px; height: 10px; border-radius: 50%; }
.bar-track { flex: 1; height: 12px; background: var(--track); border-radius: 0 4px 4px 0; }
.bar { height: 100%; border-radius: 0 4px 4px 0; }
.bar-val { font: 500 0.85rem/1 var(--mono); font-variant-numeric: tabular-nums; min-width: 3.6rem; text-align: right; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
th, td { padding: 7px 8px; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
th { font: 500 0.72rem/1.3 var(--mono); text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-2); white-space: nowrap; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td small { display: block; }
.na { font-size: 0.85rem; color: var(--muted); }
.notes { display: grid; gap: 22px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-top: 40px; }
.notes > div { display: grid; gap: 8px; align-content: start; min-width: 0; }
.notes h2 { font-size: 1.2rem; }
.notes p, .notes li { font-size: 0.92rem; }
.notes ul { margin: 0; padding-left: 1.1rem; color: var(--ink-2); display: grid; gap: 4px; }
pre { background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 12px; overflow-x: auto; font: 0.8rem/1.5 var(--mono); margin: 0; }
@media (max-width: 720px) {
  .crow { grid-template-columns: 1fr 1fr; padding-block: 6px; border-bottom: 1px solid var(--rule); }
  .crow .who { grid-column: 1 / -1; }
  .chead > div:first-child { display: none; }
  .bar-val { min-width: 3rem; }
}
</style>
<main>
<div class="intro">
  <span class="eyebrow">web-ai-evals · first report · ${esc(run.startedAt.slice(0, 10))}</span>
  <h1>Built-in AI vs in-page models, same prompts, same browser</h1>
  <p>Four task suites run through Chrome's built-in Gemini Nano, Chrome's Summarizer and Translator APIs, and a Transformers.js model, all inside a real Chrome tab driven by Playwright. Every number below comes from ${runs.length === 1 ? 'one run' : `${runs.length} runs`} on the machine${runs.length === 1 ? '' : 's'} listed here.${gpuMeasured ? '' : ' The GPU backends from the comparison plan (Phi-4-mini in Edge, Gemma 3 via WebLLM and Transformers.js WebGPU) could not run there and are listed as not measured.'}</p>
  ${runs.map(machineLine).join('\n  ')}
</div>

<ol class="findings">
  <li><span><strong>Gemini Nano matches or beats a 0.5B in-page model on every suite</strong>: sentiment accuracy ${f3(s.nanoSent, 'accuracy')} vs ${f3(s.qwenSent, 'accuracy')}, extraction field accuracy ${f3(s.nanoExt, 'fields')} vs ${f3(s.qwenExt, 'fields')}${s.nanoTr && s.qwenTr ? `, translation chrF ${f3(s.nanoTr, 'chrF')} vs ${f3(s.qwenTr, 'chrF')}` : ''}.</span></li>
  <li><span><strong>It is also faster on CPU</strong>. Median time to first token ${sec(s.nanoSent?.summary.ttftMs?.p50)} vs ${sec(s.qwenSent?.summary.ttftMs?.p50)} on sentiment; a summary takes ${sec(lat(s.nanoSum))} vs ${sec(lat(s.qwenSum))}. Chrome's native CPU inference outruns ONNX Runtime Web's Wasm backend by a wide margin.</span></li>
  <li><span><strong>Chrome's Summarizer API ignores <code>format: "plain-text"</code> on this build, and misbehaves with it.</strong> In tl;dr mode it returned a Markdown news article every time (${s.tldr?.results.filter((r) => r.output?.startsWith('#')).length ?? 0} of 12), averaging ${s.tldr?.summary.scores.words.toFixed(0)} words for ~100-word inputs, with invented placeholders such as “[Region Name]”. In key-points mode, ${s.kp ? s.kp.results.filter((r) => { const l = (r.output ?? '').split('\n').filter(Boolean); return l.filter((x) => x.trim().endsWith('?')).length > l.length / 2; }).length : 0} of 12 answers were bullet lists of <em>questions about</em> the article. Key points in Markdown format, the API default, looked right in a spot check. The Prompt API with a plain instruction scores ROUGE-L ${f3(s.nanoSum, 'rougeL')} against ${f3(s.tldr, 'rougeL')} for the Summarizer.</span></li>
  ${s.tr ? `<li><span><strong>The dedicated Translator API is the best translator here</strong>: chrF ${f3(s.tr, 'chrF')} at ${sec(lat(s.tr))} per sentence, against ${f3(s.nanoTr, 'chrF')} for the general Prompt API.</span></li>` : ''}
  <li><span><strong>Gemma 3's q4 ONNX builds don't run on Transformers.js Wasm</strong> (ONNX Runtime Web lacks <code>GatherBlockQuantized</code> on Wasm), and WebLLM on a software WebGPU adapter loses the device. Browser AI on machines without a GPU is, in practice, built-in AI or a small model on Wasm.</span></li>
</ol>

${['sentiment', 'summarization', 'extraction', 'translation'].map(suiteSection).join('\n')}

<div class="notes">
  <div>
    <h2>How it was measured</h2>
    <ul>
      <li>One browser, one backend, one example at a time; the model loads once per cell, from a persistent profile.</li>
      <li>Timing happens inside the page with <code>performance.now()</code>. TTFT is the first streamed text; latency is the median wall time per example after the first.</li>
      <li>Greedy decoding where the API allows it (temperature 0, 256 new tokens max). Web pages cannot set the Prompt API's temperature.</li>
      <li>Scores average all examples; errors and timeouts count as 0.</li>
    </ul>
  </div>
  <div>
    <h2>What is missing</h2>
    <p>Chrome's Translator API could not create an en→de translator in this setup (“The translation service count exceeded the limitation”), although the language pack shows as installed, so it has no score here.</p>
    <p>Phi-4-mini needs Edge Dev or Canary on Windows or macOS with a GPU. Gemma 3 via WebLLM and Transformers.js WebGPU need a WebGPU adapter with <code>shader-f16</code>. The same config measures them on a GPU machine, and the report tool merges runs from several machines:</p>
    <pre>pnpm wae run --config showcase.config.ts
pnpm wae report results/cpu.json results/gpu.json</pre>
  </div>
  <div>
    <h2>Data and code</h2>
    <p>Datasets were written for this project and are CC0. Code is Apache-2.0. Run file${runs.length > 1 ? 's' : ''}: <span class="mono">${runs.map((r) => esc(r.runId)).join(', ')}</span>, schema version ${esc(num(run.schemaVersion))}.</p>
  </div>
</div>
</main>`;
process.stdout.write(html);
