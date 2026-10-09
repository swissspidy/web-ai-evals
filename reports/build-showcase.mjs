// Builds the published showcase page from one or more run files.
//   node reports/build-showcase.mjs results/<run>.json [more.json] > reports/showcase/index.html
// Emits a standalone HTML document (for GitHub Pages). --fragment omits the
// document wrapper, for hosts that add their own (e.g. a claude.ai Artifact).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const runs = args.filter((a) => !a.startsWith('--')).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const wrap = (html) =>
  fragment
    ? html
    : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n${html.replace(/<main\b/, '</head>\n<body>\n<main')}\n</body>\n</html>\n`;
// Each cell remembers its run, so rows from different machines stay apart.
const cells = runs.flatMap((r, i) => r.cells.map((c) => ({ ...c, run: i })));
// Several runs from the same computer share one machine line; rows get a machine label only when machines differ.
const machineKey = (r) => [r.host.platform, r.host.cpuModel, r.host.cores, r.host.memoryBytes].join('|');
const machines = [...Map.groupBy(runs, machineKey).values()];
const multi = machines.length > 1;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sec = (ms) => (ms === undefined ? '—' : ms >= 10000 ? `${(ms / 1000).toFixed(0)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

const NAMES = {
  'gemini-nano': ['Gemini Nano', 'Prompt API · Chrome built-in'],
  'phi-4-mini': ['Phi-4-mini', 'Prompt API · Edge built-in'],
  'gemma3-1b-webllm': ['Gemma 3 1B', 'WebLLM · WebGPU · q4f16'],
  'gemma3-1b-tjs-webgpu': ['Gemma 3 1B', 'Transformers.js · WebGPU · q4f16'],
  'qwen2.5-0.5b-tjs-wasm': ['Qwen2.5 0.5B', 'Transformers.js · Wasm · q4'],
  'chrome-summarizer': ['Summarizer API', 'Chrome built-in · tl;dr mode'],
  'chrome-summarizer-keypoints': ['Summarizer API', 'Chrome built-in · key-points mode'],
  'chrome-translator': ['Translator API', 'Chrome built-in'],
  'gemma4-builtin': ['Gemma 4 2B', 'Prompt API · Chrome built-in (Gemma 4 flag)'],
};
const ORDER = Object.keys(NAMES);
// Colours follow the backend. Key-points only appears in summarization and the Translator only in
// translation, so they share slot 4 and slot 5 is free for Gemma 4.
const SLOT = { 'gemini-nano': 1, 'qwen2.5-0.5b-tjs-wasm': 2, 'chrome-summarizer': 3, 'chrome-summarizer-keypoints': 4, 'chrome-translator': 4, 'gemma4-builtin': 5, 'phi-4-mini': 6, 'gemma3-1b-webllm': 7, 'gemma3-1b-tjs-webgpu': 8 };

const SUITES = {
  sentiment: { title: 'Sentiment classification', metric: 'accuracy', metricLabel: 'Accuracy', blurb: (n) => `${n} short reviews and statements, three labels. Many are hard: sarcasm, negation, litotes, mixed verdicts.` },
  summarization: { title: 'Summarization', metric: 'rougeL', metricLabel: 'ROUGE-L F1', blurb: (n) => `${n} news-style articles of about 110 words against a one-to-two sentence reference summary.` },
  extraction: { title: 'Structured extraction', metric: 'fields', metricLabel: 'Field accuracy', blurb: (n) => `${n} restaurant booking requests to JSON with name, ISO date, city and party size.` },
  translation: { title: 'Translation EN → DE', metric: 'chrF', metricLabel: 'chrF', blurb: (n) => `${n} English sentences against a German reference translation.` },
};

const run = runs[0];
const num = (v) => (Number.isFinite(Number(v)) ? String(Number(v)) : '?');
const GPU_BACKENDS = ['phi-4-mini', 'gemma4-builtin', 'gemma3-1b-webllm', 'gemma3-1b-tjs-webgpu'];
const gpuMeasured = cells.some((c) => GPU_BACKENDS.includes(c.backend.id) && c.load.status === 'ok' && c.summary.ok > 0);

/** Short machine name for row labels, e.g. "Apple M4 Pro" or "4-core Intel Xeon". */
function machineName(r) {
  const cpu = (r.cells[0]?.environment.hardware.cpuModel ?? r.host.cpuModel ?? '?')
    .replace(/\((R|TM)\)/g, '')
    .replace(/\s*(CPU|Processor)\b.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return hasGpu(r) ? cpu : `${num(r.host.cores)}-core ${cpu}`;
}
const hasGpu = (r) => r.cells.some((c) => c.environment.gpu);
const tag = (r) => `${machineName(r)} · ${hasGpu(r) ? 'GPU' : 'no GPU'}`;

/** One line per machine, from any cell of that run (loaded or not). */
function machineLine(group) {
  const r = group[0];
  const all = group.flatMap((g) => g.cells);
  const cell = all.find((c) => c.load.status === 'ok') ?? all[0];
  if (!cell) return '';
  const e = cell.environment;
  const gpu = all.map((c) => c.environment.gpu).find(Boolean);
  // Every built-in model that ran on this machine (Gemini Nano, Gemma 4, …) with its version.
  const models = [...new Map(all.filter((c) => c.backend.kind === 'prompt-api' && c.load.status === 'ok').map((c) => [c.backend.id, c.environment.backend])).values()];
  const versions = [...new Set(all.map((c) => c.environment.browser.version))].map(esc).join(', ');
  const parts = [
    ...(multi ? [`<strong>${esc(tag(r))}</strong>`] : []),
    `${esc(e.browser.name)} ${versions} (${esc(e.browser.channel ?? '')}, ${e.browser.headless ? 'headless' : 'headful'})`,
    `${esc(e.os.platform)} ${esc(e.os.arch)}`,
    `${esc(e.hardware.cpuModel ?? r.host.cpuModel ?? '')} · ${num(e.hardware.cores)} cores · ${num(Math.round((e.hardware.memoryBytes ?? r.host.memoryBytes) / 2 ** 30))} GiB`,
    gpu ? `GPU ${esc([gpu.vendor, gpu.architecture, gpu.description].filter(Boolean).join(' '))}` : 'no GPU, no WebGPU adapter',
  ];
  for (const m of models) {
    const comps = m.details?.builtInComponents ?? {};
    parts.push(`${esc(m.model ?? 'built-in model')} ${esc(comps.baseModelVersion ?? m.modelVersion ?? '')}${comps.onDeviceModel ? ` · asset ${esc(comps.onDeviceModel)}` : ''}`);
  }
  return `<div class="machine">${parts.map((p) => `<span>${p}</span>`).join('')}</div>`;
}

if (!cells.some((c) => c.load.status === 'ok')) {
  process.stdout.write(wrap(`<title>Built-in AI vs In-Page Models</title><main style="max-width:680px;margin:0 auto;padding:40px 16px;font:16px/1.5 system-ui,sans-serif"><h1>No results</h1><p>No backend loaded in ${runs.length} run(s): ${esc(cells.map((c) => `${c.backend.id}: ${c.load.error ?? c.load.status}`).slice(0, 12).join('; '))}</p></main>`));
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

/** Machine label under a row's name, only when the report merges several machines. */
const where = (c) => (multi ? `<small>${esc(tag(runs[c.run]))}</small>` : '');

/** First sentence of an error message, so long library errors stay readable. */
const firstSentence = (e) => String(e).split(/\.\s|\n/)[0].replace(/\.$/, '').slice(0, 200);

function notMeasured(r, skipped) {
  if (!skipped.length) return '';
  // "No WebGPU adapter" only for the in-page WebGPU runtimes on a machine without one; anything else keeps its own error.
  const needsAdapter = (c) => !hasGpu(r) && (c.backend.kind === 'webllm' || (c.backend.kind === 'transformers' && c.backend.device !== 'wasm'));
  const reason = (c) => (needsAdapter(c) ? 'No WebGPU adapter' : firstSentence(c.load.error ?? c.load.status));
  const groups = Map.groupBy(skipped, reason);
  const label = (c) => `${esc((NAMES[c.backend.id] ?? [c.backend.id])[0])} (${esc((NAMES[c.backend.id] ?? ['', ''])[1])})`;
  return `<p class="na">Not measured on ${multi ? `the ${esc(machineName(r))}` : 'this machine'}: ${[...groups].map(([why, cs]) => `${cs.map(label).join(', ')}. ${esc(why.replace(/\.$/, ''))}.`).join(' ')}</p>`;
}

/** Examples per cell as they ran; runs made with different dataset versions show a range. */
function exampleCount(ran) {
  const ns = [...new Set(ran.map((c) => c.summary.total))].sort((a, b) => a - b);
  return ns.length > 1 ? `${ns[0]}–${ns.at(-1)}` : String(ns[0]);
}

function suiteSection(id) {
  const meta = SUITES[id];
  const all = cells.filter((c) => c.dataset.id === id).sort((a, b) => ORDER.indexOf(a.backend.id) - ORDER.indexOf(b.backend.id) || a.run - b.run);
  const ran = all.filter((c) => c.load.status === 'ok');
  const skipped = all.filter((c) => c.load.status !== 'ok');
  if (!ran.length) return '';
  const lat = (c) => c.summary.warm?.totalMs?.p50 ?? c.summary.totalMs?.p50;
  // Runs made before and after a suite grew can't be compared on scores; label each row with its size.
  const mixed = new Set(ran.map((c) => c.dataset.sha256)).size > 1;
  const size = (c) => (mixed ? `<small>${num(c.summary.total)} examples</small>` : '');
  const maxLat = Math.max(...ran.map((c) => lat(c) ?? 0));
  const bar = (v, max, fmt, slot) => {
    const w = v === undefined ? 0 : Math.max(0.5, (v / max) * 100);
    return `<div class="bar-row"><div class="bar-track"><div class="bar" style="width:${w.toFixed(2)}%;background:var(--s${slot})"></div></div><span class="bar-val">${fmt(v)}</span></div>`;
  };
  const chartRows = ran
    .map((c) => {
      const [n, sub] = NAMES[c.backend.id] ?? [c.backend.id, ''];
      const slot = SLOT[c.backend.id] ?? 8;
      return `<div class="crow"><div class="who"><span class="key" style="background:var(--s${slot})"></span><span><strong>${esc(n)}</strong><small>${esc(sub)}</small>${where(c)}${size(c)}</span></div>${bar(c.summary.scores[meta.metric], 1, (v) => v.toFixed(3), slot)}${bar(lat(c), maxLat, sec, slot)}</div>`;
    })
    .join('');
  const rows = ran
    .map((c) => {
      const s = c.summary;
      const extra = id === 'summarization' ? `${s.scores.words?.toFixed(0)} words` : id === 'extraction' ? `${(s.scores.jsonSchema * 100).toFixed(0)}% schema-valid` : id === 'sentiment' ? `macro-F1 ${s.aggregates['accuracy.macroF1']?.toFixed(3)}` : `${(s.scores.exact * 100).toFixed(0)}% contain the reference`;
      return `<tr><td>${esc(NAMES[c.backend.id]?.[0] ?? c.backend.id)} <small>${esc(NAMES[c.backend.id]?.[1] ?? '')}</small>${where(c)}${size(c)}</td><td class="n">${s.scores[meta.metric].toFixed(3)}</td><td class="n">${esc(extra)}</td><td class="n">${sec(s.ttftMs?.p50)}</td><td class="n">${sec(lat(c))}</td><td class="n">${s.tokensPerSecond ? s.tokensPerSecond.p50.toFixed(1) : '—'}</td><td class="n">${num(s.ok)}/${num(s.total)}</td></tr>`;
    })
    .join('');
  return `<section class="suite" id="${id}">
  <header><h2>${esc(meta.title)}</h2><p>${esc(meta.blurb(exampleCount(ran)))}</p></header>
  <div class="chart">
    <div class="crow chead"><div></div><div class="col-head">${esc(meta.metricLabel)} <span>higher is better, 0–1</span></div><div class="col-head">Median latency per example <span>lower is better</span></div></div>
    ${chartRows}
  </div>
  ${mixed ? `<p class="na">These rows ran different versions of this suite (${exampleCount(ran)} examples). Compare scores only between rows with the same number of examples.</p>` : ''}
  <div class="scroll"><table><thead><tr><th>Backend</th><th class="n">${esc(meta.metricLabel)}</th><th class="n">Detail</th><th class="n">TTFT p50</th><th class="n">Latency p50</th><th class="n">Tokens/s p50</th><th class="n">OK</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${runs.map((r, i) => notMeasured(r, skipped.filter((c) => c.run === i))).join('')}
</section>`;
}

// `run` picks the machine; the CPU findings compare backends from the same run.
const ok = (id, b, run) => cells.find((c) => c.dataset.id === id && c.backend.id === b && c.load.status === 'ok' && (run === undefined || c.run === run));
const f3 = (c, m) => c?.summary.scores[m]?.toFixed(3) ?? '—';
const runWith = (pred) => runs.findIndex((r, i) => cells.some((c) => c.run === i && c.load.status === 'ok' && pred(c, r)));
// -1 when no run is CPU-only; the CPU findings are then left out rather than filled with GPU numbers.
const cpuRun = runWith((c, r) => !hasGpu(r) && c.backend.id === 'gemini-nano');
const gpuRun = runWith((c, r) => hasGpu(r) && c.backend.id === 'gemini-nano');
const SUITE_IDS = ['sentiment', 'summarization', 'extraction', 'translation'];
const METRIC = Object.fromEntries(SUITE_IDS.map((id) => [id, SUITES[id].metric]));
const FINDING_LABEL = { sentiment: 'sentiment accuracy', summarization: 'summary ROUGE-L', extraction: 'extraction field accuracy', translation: 'translation chrF' };
// Gemma 4 vs Gemini Nano on the same GPU machine.
const g4 = gpuRun < 0 ? [] : SUITE_IDS.map((id) => [id, ok(id, 'gemma4-builtin', gpuRun), ok(id, 'gemini-nano', gpuRun)]).filter(([, a, b]) => a && b);
// Gemini Nano on the GPU machine vs the CPU machine.
const nanoHw = gpuRun < 0 || gpuRun === cpuRun ? [] : SUITE_IDS.map((id) => [id, ok(id, 'gemini-nano', gpuRun), ok(id, 'gemini-nano', cpuRun)]).filter(([, a, b]) => a && b);
const s = {
  nanoSent: ok('sentiment', 'gemini-nano', cpuRun), qwenSent: ok('sentiment', 'qwen2.5-0.5b-tjs-wasm', cpuRun),
  nanoSum: ok('summarization', 'gemini-nano', cpuRun), qwenSum: ok('summarization', 'qwen2.5-0.5b-tjs-wasm', cpuRun),
  tldr: ok('summarization', 'chrome-summarizer', cpuRun), kp: ok('summarization', 'chrome-summarizer-keypoints', cpuRun),
  nanoExt: ok('extraction', 'gemini-nano', cpuRun), qwenExt: ok('extraction', 'qwen2.5-0.5b-tjs-wasm', cpuRun),
  nanoTr: ok('translation', 'gemini-nano', cpuRun), qwenTr: ok('translation', 'qwen2.5-0.5b-tjs-wasm', cpuRun), tr: ok('translation', 'chrome-translator', cpuRun),
};
const lat = (c) => c?.summary.warm?.totalMs?.p50 ?? c?.summary.totalMs?.p50;

/** Score per example id (first repeat). */
function byId(c, m) {
  const out = new Map();
  for (const x of c.results) if (!out.has(x.exampleId)) out.set(x.exampleId, x.scores?.[m] ?? 0);
  return out;
}
const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/** 95% bootstrap interval of a mean difference. Seeded, so rebuilding the page doesn't change it. */
function pairedCI(diffs, rounds = 4000) {
  let seed = 0x2545f491;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const means = [];
  for (let r = 0; r < rounds; r++) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i++) sum += diffs[Math.floor(rand() * diffs.length)];
    means.push(sum / diffs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(rounds * 0.025)], means[Math.floor(rounds * 0.975)]];
}

/** Paired comparison of two cells on the examples both ran (optionally only `only`). */
function compare(a, b, m, only) {
  const A = byId(a, m);
  const B = byId(b, m);
  const ids = [...A.keys()].filter((id) => B.has(id) && (!only || only.has(id)));
  // Cells with no examples in common can't be compared; callers skip them.
  if (!ids.length) return { ids, n: 0, a: NaN, b: NaN, d: NaN, lo: NaN, hi: NaN };
  const d = ids.map((id) => A.get(id) - B.get(id));
  const [lo, hi] = pairedCI(d);
  return { ids, n: ids.length, a: mean(ids.map((id) => A.get(id))), b: mean(ids.map((id) => B.get(id))), d: mean(d), lo, hi };
}

/** Ids of the examples marked hard, when the dataset file is present and unchanged since the run. */
function hardIds(ref) {
  try {
    const text = readFileSync(ref.path, 'utf8');
    if (createHash('sha256').update(text).digest('hex') !== ref.sha256) return undefined;
    const rows = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    return new Set(rows.filter((x) => x.meta?.difficulty === 'hard').map((x) => x.id));
  } catch {
    return undefined;
  }
}

const signed = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(3)}`;
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

function g4Finding() {
  if (!g4.length) return '';
  const cmp = g4.map(([id, gemma, nano]) => ({ id, gemma, nano, ...compare(gemma, nano, METRIC[id]) })).filter((c) => c.n);
  if (!cmp.length) return '';
  const worse = cmp.filter((c) => c.hi < 0);
  const better = cmp.filter((c) => c.lo > 0);
  const level = cmp.filter((c) => c.lo <= 0 && c.hi >= 0);
  const head =
    worse.length || better.length
      ? `On the same machine, Gemma 4 ${[worse.length && `trails Gemini Nano on ${list(worse.map((c) => c.id))}`, better.length && `beats it on ${list(better.map((c) => c.id))}`].filter(Boolean).join(' and ')}${level.length ? `, and the two are level on ${list(level.map((c) => c.id))}` : ''}`
      : 'On the same machine, Gemma 4 and Gemini Nano are level on every suite';
  const detail = cmp.map((c) => `${FINDING_LABEL[c.id]} ${c.a.toFixed(3)} vs ${c.b.toFixed(3)} (${signed(c.d)}, 95% CI ${signed(c.lo)} to ${signed(c.hi)}, ${c.n} examples)`).join('; ');
  // Where a gap shows, say whether the hard examples carry it.
  const hard = [...worse, ...better]
    .map((c) => {
      const h = hardIds(c.gemma.dataset);
      if (!h?.size) return '';
      const hc = compare(c.gemma, c.nano, METRIC[c.id], h);
      const rc = compare(c.gemma, c.nano, METRIC[c.id], new Set(c.ids.filter((id) => !h.has(id))));
      return hc.n && rc.n ? ` The ${c.id} gap is in the hard examples: ${hc.a.toFixed(3)} vs ${hc.b.toFixed(3)} on the ${hc.n} hard ones, ${rc.a.toFixed(3)} vs ${rc.b.toFixed(3)} on the other ${rc.n}.` : '';
    })
    .join('');
  const { id: first, gemma: g, nano: n } = cmp[0];
  const sum = g4.find(([id]) => id === 'summarization');
  const streams = sum && sum[1].summary.tokensPerSecond && sum[2].summary.tokensPerSecond ? `, but Gemma 4 streams faster once it starts (${sum[1].summary.tokensPerSecond.p50.toFixed(0)} vs ${sum[2].summary.tokensPerSecond.p50.toFixed(0)} tokens/s on summaries)` : '';
  return `<li><span><strong>${head}</strong> (${esc(machineName(runs[gpuRun]))}, Chrome ${esc(cells.find((c) => c.run === gpuRun).environment.browser.version)}): ${detail}.${hard} Gemini Nano answers sooner (time to first token ${sec(n.summary.ttftMs?.p50)} vs ${sec(g.summary.ttftMs?.p50)} for Gemma 4 on ${first})${streams}.${cpuRun >= 0 ? ' Gemma 4 needs a GPU: on the CPU-only machine, Chrome 154 downloaded it but crashed every time it created a session.' : ''}</span></li>`;
}

/** Gemma 3 1B in the page (Transformers.js, WebGPU) against Gemini Nano on the same computer. */
function gemma3Finding() {
  if (gpuRun < 0) return '';
  const key = machineKey(runs[gpuRun]);
  const cmp = SUITE_IDS.map((id) => {
    const t = cells.find((c) => c.dataset.id === id && c.backend.id === 'gemma3-1b-tjs-webgpu' && c.load.status === 'ok' && machineKey(runs[c.run]) === key);
    const n = ok(id, 'gemini-nano', gpuRun);
    return t && n ? { id, t, nano: n, ...compare(t, n, METRIC[id]) } : undefined;
  }).filter((c) => c?.n);
  if (!cmp.length) return '';
  const worse = cmp.filter((c) => c.hi < 0).map((c) => c.id);
  const better = cmp.filter((c) => c.lo > 0).map((c) => c.id);
  const quality = [worse.length && `scores below Gemini Nano on ${list(worse)}`, better.length && `above it on ${list(better)}`].filter(Boolean).join(' and ') || 'scores level with Gemini Nano';
  const faster = cmp.filter((c) => lat(c.t) < lat(c.nano)).length;
  const speed = faster === cmp.length ? 'faster than Gemini Nano on every suite' : faster === 0 ? 'slower than Gemini Nano on every suite' : `faster than Gemini Nano on ${faster} of ${cmp.length} suites`;
  return `<li><span><strong>Gemma 3 1B in the page (Transformers.js on WebGPU) is ${speed} on the ${esc(machineName(runs[gpuRun]))}, but ${quality}</strong>: ${cmp.map((c) => `${FINDING_LABEL[c.id]} ${c.a.toFixed(3)} vs ${c.b.toFixed(3)} (95% CI of the difference ${signed(c.lo)} to ${signed(c.hi)}) at ${sec(lat(c.t))} vs ${sec(lat(c.nano))} per example`).join('; ')}. The page downloads this ${esc(cmp[0].t.environment.backend.dtype ?? '')} model itself, while Gemini Nano ships with Chrome.</span></li>`;
}

function nanoHwFinding() {
  if (!nanoHw.length) return '';
  // Only the examples both runs share, so a suite that grew in between doesn't skew the comparison.
  const rows = nanoHw.map(([id, g, c]) => {
    const cmp = compare(g, c, METRIC[id]);
    const ids = new Set(cmp.ids);
    const t = (cell) => median(cell.results.filter((x) => ids.has(x.exampleId) && x.phase !== 'cold').map((x) => x.timings.totalMs));
    return { id, cmp, g: t(g), c: t(c) };
  }).filter((x) => x.cmp.n);
  if (!rows.length) return '';
  const r = rows.map((x) => x.c / x.g);
  const tr = rows.find((x) => x.id === 'translation');
  const grew = rows.some((x) => x.cmp.n < Math.max(nanoHw.find(([id]) => id === x.id)[1].summary.total, nanoHw.find(([id]) => id === x.id)[2].summary.total));
  return `<li><span><strong>Gemini Nano is ${Math.min(...r).toFixed(0)}–${Math.max(...r).toFixed(0)}× faster on the ${esc(machineName(runs[gpuRun]))}'s GPU than on the CPU-only machine</strong>. Median time per example${grew ? ' on the examples both runs share' : ''}: ${rows.map((x) => `${sec(x.g)} vs ${sec(x.c)} on ${x.id}`).join(', ')}.${tr ? ` Its scores differ too (translation chrF ${tr.cmp.a.toFixed(3)} vs ${tr.cmp.b.toFixed(3)} on the same ${tr.cmp.n} sentences), but Chrome ships different Nano builds for GPU and CPU and the two machines ran different Chrome versions, so the score gap isn't down to the hardware alone.` : ''}</span></li>`;
}

// GPU backends without a successful cell, with what they need (or why they failed where they were tried).
const NEEDS = { 'phi-4-mini': 'needs Edge Dev or Canary on Windows or macOS with a GPU', 'gemma3-1b-webllm': 'needs a WebGPU adapter with shader-f16', 'gemma3-1b-tjs-webgpu': 'needs a WebGPU adapter with shader-f16' };
const missingGpu = Object.keys(NEEDS)
  .filter((id) => !cells.some((c) => c.backend.id === id && c.load.status === 'ok'))
  .map((id) => {
    const failed = cells.find((c) => c.backend.id === id && c.load.status === 'error' && hasGpu(runs[c.run]));
    return { id, why: failed ? `failed to load on the ${machineName(runs[failed.run])} (${firstSentence(failed.load.error)})` : NEEDS[id] };
  });

const html = `<title>Built-in AI vs In-Page Models</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: one reading column; each suite is a three-column bench sheet (who | quality | latency) that stacks on phones. */
:root {
  --paper: #f5f6f4; --sheet: #fcfcfb; --ink: #15181b; --ink-2: #4f5559; --muted: #686e72; --rule: #dfe1dd; --track: #eceeea; --accent: #1f5f8b;
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
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 var(--body); }
*, *::before, *::after { box-sizing: border-box; }
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
  <span class="eyebrow">web-ai-evals · first report · ${esc(run.startedAt.slice(0, 10))}${multi ? ` · updated ${esc(runs.at(-1).startedAt.slice(0, 10))}` : ''}</span>
  <h1>Built-in AI vs in-page models, same prompts, same browser</h1>
  <p>Four task suites run through Chrome's built-in Gemini Nano${g4.length ? ' and Gemma 4 (behind a Chrome flag)' : ''}, Chrome's Summarizer and Translator APIs, and a Transformers.js model, all inside a real Chrome tab driven by Playwright. Every number below comes from ${runs.length === 1 ? 'one run' : `${runs.length} runs`} on the machine${runs.length === 1 ? '' : 's'} listed here.${gpuMeasured ? '' : ' The GPU backends from the comparison plan (Phi-4-mini in Edge, Gemma 3 via WebLLM and Transformers.js WebGPU) could not run there and are listed as not measured.'}</p>
  ${machines.map(machineLine).join('\n  ')}
</div>

<ol class="findings">
  ${g4Finding()}
  ${gemma3Finding()}
  ${nanoHwFinding()}
  ${s.nanoSent && s.qwenSent ? `<li><span><strong>On CPU, Gemini Nano matches or beats a 0.5B in-page model on every suite</strong>: sentiment accuracy ${f3(s.nanoSent, 'accuracy')} vs ${f3(s.qwenSent, 'accuracy')}, extraction field accuracy ${f3(s.nanoExt, 'fields')} vs ${f3(s.qwenExt, 'fields')}${s.nanoTr && s.qwenTr ? `, translation chrF ${f3(s.nanoTr, 'chrF')} vs ${f3(s.qwenTr, 'chrF')}` : ''}.</span></li>
  <li><span><strong>It is also faster</strong>. Median time to first token ${sec(s.nanoSent?.summary.ttftMs?.p50)} vs ${sec(s.qwenSent?.summary.ttftMs?.p50)} on sentiment; a summary takes ${sec(lat(s.nanoSum))} vs ${sec(lat(s.qwenSum))}. Chrome's native CPU inference outruns ONNX Runtime Web's Wasm backend by a wide margin.</span></li>` : ''}
  ${s.tldr && s.nanoSum ? `<li><span><strong>Chrome's Summarizer API ignores <code>format: "plain-text"</code> on this build, and misbehaves with it.</strong> In tl;dr mode it returned a Markdown news article every time (${s.tldr?.results.filter((r) => r.output?.startsWith('#')).length ?? 0} of 12), averaging ${s.tldr?.summary.scores.words.toFixed(0)} words for ~100-word inputs, with invented placeholders such as “[Region Name]”. In key-points mode, ${s.kp ? s.kp.results.filter((r) => { const l = (r.output ?? '').split('\n').filter(Boolean); return l.filter((x) => x.trim().endsWith('?')).length > l.length / 2; }).length : 0} of 12 answers were bullet lists of <em>questions about</em> the article. Key points in Markdown format, the API default, looked right in a spot check. The Prompt API with a plain instruction scores ROUGE-L ${f3(s.nanoSum, 'rougeL')} against ${f3(s.tldr, 'rougeL')} for the Summarizer.</span></li>` : ''}
  ${s.tr && s.nanoTr ? `<li><span><strong>Chrome's Translator API matches Gemini Nano on translation at a fraction of the latency</strong>: chrF ${f3(s.tr, 'chrF')} vs ${f3(s.nanoTr, 'chrF')}, with the exact reference phrasing in ${Math.round(s.tr.summary.scores.exact * 100)}% vs ${Math.round(s.nanoTr.summary.scores.exact * 100)}% of sentences, at ${sec(lat(s.tr))} vs ${sec(lat(s.nanoTr))} per sentence. On first use it fails until Chrome has installed its translation runtime and language pack, with errors that don't say so; the runner retries until the install finishes.</span></li>` : ''}
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
    ${s.tr ? '' : `<p>Chrome's Translator API could not create an en→de translator in this run, so it has no score here.</p>`}
    ${missingGpu.length ? `<p>Not measured yet: ${missingGpu.map(({ id, why }) => `${esc((NAMES[id] ?? [id])[0])} (${esc((NAMES[id] ?? ['', ''])[1])}), which ${esc(why)}`).join('; ')}. The same config measures them, and the report tool merges runs from several machines:</p>` : '<p>Every backend in the comparison plan has been measured. To add a machine, run the same config there; the report tool merges runs from several machines:</p>'}
    <pre>pnpm wae run --config showcase.config.ts
pnpm wae report results/cpu.json results/gpu.json</pre>
  </div>
  <div>
    <h2>Data and code</h2>
    <p>Datasets were written for this project and are CC0. Code is Apache-2.0. Run file${runs.length > 1 ? 's' : ''}: <span class="mono">${runs.map((r) => esc(r.runId)).join(', ')}</span>, schema version ${esc(num(run.schemaVersion))}.</p>
  </div>
</div>
</main>`;
process.stdout.write(wrap(html));
