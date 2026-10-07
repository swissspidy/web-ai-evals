import { normalizeText, references, type Scorer } from './types.js';

/** 1 when the normalized output equals any reference. */
export function exactMatch(opts: { name?: string; normalize?: boolean } = {}): Scorer {
  const norm = opts.normalize === false ? (s: string) => s.trim() : normalizeText;
  return {
    name: opts.name ?? 'exact',
    score: ({ output, example }) => (references(example.expected).some((r) => norm(r) === norm(output)) ? 1 : 0),
  };
}

/** 1 when the output contains any reference (normalized). */
export function contains(opts: { name?: string } = {}): Scorer {
  return {
    name: opts.name ?? 'contains',
    score: ({ output, example }) =>
      references(example.expected).some((r) => normalizeText(output).includes(normalizeText(r))) ? 1 : 0,
  };
}

/** 1 when the output matches the pattern (or `example.meta.pattern`). */
export function regex(pattern?: RegExp | string, opts: { name?: string } = {}): Scorer {
  return {
    name: opts.name ?? 'regex',
    score: ({ output, example }) => {
      const p = pattern ?? (example.meta?.pattern as string | undefined);
      if (!p) throw new Error('regex scorer needs a pattern or example.meta.pattern');
      return (typeof p === 'string' ? new RegExp(p, 'i') : p).test(output) ? 1 : 0;
    },
  };
}

function tokens(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(' ') : [];
}

function lcs(a: string[], b: string[]): number {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** ROUGE-L F1 against the best matching reference. */
export function rougeL(opts: { name?: string } = {}): Scorer {
  return {
    name: opts.name ?? 'rougeL',
    score: ({ output, example }) => {
      const out = tokens(output);
      let best = 0;
      for (const ref of references(example.expected)) {
        const r = tokens(ref);
        if (!r.length || !out.length) continue;
        const l = lcs(out, r);
        const p = l / out.length;
        const rec = l / r.length;
        best = Math.max(best, p + rec ? (2 * p * rec) / (p + rec) : 0);
      }
      return best;
    },
  };
}

function charNgrams(s: string, n: number): Map<string, number> {
  const text = s.replace(/\s+/g, ' ').trim();
  const grams = new Map<string, number>();
  for (let i = 0; i + n <= text.length; i++) {
    const g = text.slice(i, i + n);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/**
 * chrF (character n-gram F-score, n=1..6, beta=2), a standard translation
 * metric that works without tokenization. Returns 0..1.
 */
export function chrF(opts: { name?: string; maxN?: number; beta?: number } = {}): Scorer {
  const maxN = opts.maxN ?? 6;
  const beta = opts.beta ?? 2;
  const one = (hyp: string, ref: string) => {
    let p = 0;
    let r = 0;
    let count = 0;
    for (let n = 1; n <= maxN; n++) {
      const h = charNgrams(hyp, n);
      const rf = charNgrams(ref, n);
      let hTotal = 0;
      let rTotal = 0;
      let match = 0;
      for (const v of h.values()) hTotal += v;
      for (const v of rf.values()) rTotal += v;
      for (const [g, v] of h) match += Math.min(v, rf.get(g) ?? 0);
      if (hTotal === 0 || rTotal === 0) continue;
      p += match / hTotal;
      r += match / rTotal;
      count++;
    }
    if (!count) return 0;
    p /= count;
    r /= count;
    const b2 = beta * beta;
    return p + r ? ((1 + b2) * p * r) / (b2 * p + r) : 0;
  };
  return {
    name: opts.name ?? 'chrF',
    score: ({ output, example }) => Math.max(0, ...references(example.expected).map((ref) => one(output, ref))),
  };
}

/** Output length in words (not normalized; useful to spot verbosity). */
export function wordCount(opts: { name?: string } = {}): Scorer {
  return { name: opts.name ?? 'words', score: ({ output }) => tokens(output).length };
}
