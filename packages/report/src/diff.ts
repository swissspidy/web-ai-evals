import type { CellResult, RunFile } from '@web-ai-evals/core';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ScoreDelta {
  metric: string;
  before: number;
  after: number;
  delta: number;
  flagged: boolean;
}

export interface LatencyDelta {
  metric: 'ttftMs.p50' | 'totalMs.p50' | 'tokensPerSecond.p50';
  before?: number;
  after?: number;
  ratio?: number;
  flagged: boolean;
}

export interface CellDiff {
  /** dataset/backend, plus browser ids when they differ between sides. */
  key: string;
  before: CellResult;
  after: CellResult;
  envChanges: FieldChange[];
  scores: ScoreDelta[];
  latency: LatencyDelta[];
  statusChanged: boolean;
  /** Examples whose output text differs. */
  changedOutputs: { exampleId: string; before?: string; after?: string }[];
  flags: string[];
}

export interface RunDiff {
  before: { runId: string; startedAt: string; name?: string };
  after: { runId: string; startedAt: string; name?: string };
  cells: CellDiff[];
  onlyBefore: string[];
  onlyAfter: string[];
  /** Human-readable reasons why this diff needs attention. */
  flags: string[];
}

export interface DiffOptions {
  /** Absolute score change that counts as a change. Default 0.05. */
  scoreThreshold?: number;
  /** Latency ratio (after/before or before/after) that counts as a change. Default 1.5. */
  latencyRatio?: number;
  /** Compare a browser in the "before" run with a different browser in "after" (e.g. chrome vs chrome-canary). */
  browsers?: { before: string; after: string };
  /** Flag environment changes to these fields. Default: model version, model, browser version. */
  flagFields?: string[];
}

const ENV_FIELDS: Array<[string, (c: CellResult) => unknown]> = [
  ['browser.version', (c) => c.environment.browser.version],
  ['backend.model', (c) => c.environment.backend.model],
  ['backend.modelVersion', (c) => c.environment.backend.modelVersion],
  ['backend.builtInComponents', (c) => c.environment.backend.details?.builtInComponents],
  ['backend.dtype', (c) => c.environment.backend.dtype],
  ['gpu', (c) => [c.environment.gpu?.vendor, c.environment.gpu?.architecture, c.environment.gpu?.description].filter(Boolean).join(' ') || undefined],
  ['os', (c) => `${c.environment.os.platform} ${c.environment.os.release}`],
  ['dataset.sha256', (c) => c.dataset.sha256],
  ['flags', (c) => c.environment.flags.join(' ')],
];

const DEFAULT_FLAG_FIELDS = ['backend.modelVersion', 'backend.model', 'backend.builtInComponents', 'dataset.sha256'];

function cellKey(c: CellResult, includeBrowser: boolean): string {
  return includeBrowser ? `${c.dataset.id}/${c.backend.id}/${c.environment.browser.id}` : `${c.dataset.id}/${c.backend.id}`;
}

export function diffRuns(before: RunFile, after: RunFile, options: DiffOptions = {}): RunDiff {
  const scoreThreshold = options.scoreThreshold ?? 0.05;
  const latencyRatio = options.latencyRatio ?? 1.5;
  const flagFields = options.flagFields ?? DEFAULT_FLAG_FIELDS;
  const pick = (run: RunFile, browser?: string) => run.cells.filter((c) => !browser || c.environment.browser.id === browser);
  const cross = !!options.browsers;
  const a = new Map(pick(before, options.browsers?.before).map((c) => [cellKey(c, !cross), c]));
  const b = new Map(pick(after, options.browsers?.after).map((c) => [cellKey(c, !cross), c]));

  const cells: CellDiff[] = [];
  for (const [key, cb] of a) {
    const ca = b.get(key);
    if (!ca) continue;
    cells.push(diffCell(cross ? `${key} (${options.browsers!.before} → ${options.browsers!.after})` : key, cb, ca, scoreThreshold, latencyRatio, flagFields));
  }
  const flags = cells.flatMap((c) => c.flags.map((f) => `${c.key}: ${f}`));
  return {
    before: { runId: before.runId, startedAt: before.startedAt, name: before.name },
    after: { runId: after.runId, startedAt: after.startedAt, name: after.name },
    cells,
    onlyBefore: [...a.keys()].filter((k) => !b.has(k)),
    onlyAfter: [...b.keys()].filter((k) => !a.has(k)),
    flags,
  };
}

function diffCell(key: string, before: CellResult, after: CellResult, scoreThreshold: number, latencyRatio: number, flagFields: string[]): CellDiff {
  const flags: string[] = [];
  const envChanges: FieldChange[] = [];
  for (const [field, get] of ENV_FIELDS) {
    const x = get(before);
    const y = get(after);
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      envChanges.push({ field, before: x, after: y });
      if (flagFields.includes(field)) flags.push(`${field} changed: ${fmt(x)} → ${fmt(y)}`);
    }
  }

  const scores: ScoreDelta[] = [];
  const metrics = new Set([...Object.keys(before.summary.scores), ...Object.keys(before.summary.aggregates)]);
  for (const metric of metrics) {
    const x = before.summary.scores[metric] ?? before.summary.aggregates[metric];
    const y = after.summary.scores[metric] ?? after.summary.aggregates[metric];
    if (x === undefined || y === undefined || metric.includes('.f1:')) continue;
    const delta = y - x;
    const flagged = Math.abs(delta) >= scoreThreshold;
    scores.push({ metric, before: x, after: y, delta, flagged });
    if (flagged) flags.push(`${metric} ${delta > 0 ? 'improved' : 'regressed'}: ${x.toFixed(3)} → ${y.toFixed(3)}`);
  }

  const latency: LatencyDelta[] = [];
  const lat = (c: CellResult, m: LatencyDelta['metric']) => {
    const [field] = m.split('.') as ['ttftMs' | 'totalMs' | 'tokensPerSecond'];
    return c.summary[field]?.p50;
  };
  for (const metric of ['ttftMs.p50', 'totalMs.p50', 'tokensPerSecond.p50'] as const) {
    const x = lat(before, metric);
    const y = lat(after, metric);
    const ratio = x && y ? y / x : undefined;
    const flagged = ratio !== undefined && (ratio >= latencyRatio || ratio <= 1 / latencyRatio);
    latency.push({ metric, before: x, after: y, ratio, flagged });
    if (flagged) flags.push(`${metric} changed ×${ratio!.toFixed(2)}: ${x!.toFixed(1)} → ${y!.toFixed(1)}`);
  }

  const statusChanged = before.load.status !== after.load.status || before.summary.ok !== after.summary.ok;
  if (statusChanged) {
    flags.push(`status changed: ${before.load.status} ${before.summary.ok}/${before.summary.total} ok → ${after.load.status} ${after.summary.ok}/${after.summary.total} ok`);
  }

  const outA = new Map(before.results.filter((r) => r.repeat === 1).map((r) => [r.exampleId, r.output]));
  const changedOutputs = after.results
    .filter((r) => r.repeat === 1 && outA.has(r.exampleId) && (outA.get(r.exampleId) ?? '').trim() !== (r.output ?? '').trim())
    .map((r) => ({ exampleId: r.exampleId, before: outA.get(r.exampleId), after: r.output }));

  return { key, before, after, envChanges, scores, latency, statusChanged, changedOutputs, flags };
}

function fmt(v: unknown): string {
  if (v === undefined) return '(none)';
  return typeof v === 'string' ? v : JSON.stringify(v);
}
