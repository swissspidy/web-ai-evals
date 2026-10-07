import { matchLabel } from '../core/index.js';
import type { AggregateItem, Scorer } from './types.js';

/**
 * Classification accuracy per example, plus dataset-level macro F1 and
 * per-label F1 via `aggregate`. The output is mapped onto the candidate labels
 * (exact match first, then earliest mention), so "Positive." counts as "positive".
 */
export function classification(opts: { name?: string; labels?: string[] } = {}): Scorer {
  const name = opts.name ?? 'accuracy';
  const labelsFor = (item: { input: { labels?: string[] } }) => opts.labels ?? item.input.labels ?? [];
  return {
    name,
    score: ({ output, example, input }) => {
      const labels = labelsFor({ input });
      const predicted = labels.length ? matchLabel(output, labels) : output.trim();
      return {
        score: String(predicted ?? '').toLowerCase() === String(example.expected).toLowerCase() ? 1 : 0,
        detail: { predicted: predicted ?? null },
      };
    },
    aggregate(items: AggregateItem[]) {
      const labels = new Set<string>();
      const pairs: { gold: string; pred: string | undefined }[] = [];
      for (const item of items) {
        const gold = String(item.example.expected);
        labels.add(gold);
        const ls = labelsFor(item);
        ls.forEach((l) => labels.add(l));
        const pred = item.output === undefined ? undefined : ls.length ? matchLabel(item.output, ls) : item.output.trim();
        pairs.push({ gold: gold.toLowerCase(), pred: pred?.toLowerCase() });
      }
      const out: Record<string, number> = {};
      let f1Sum = 0;
      for (const label of labels) {
        const l = label.toLowerCase();
        const tp = pairs.filter((p) => p.pred === l && p.gold === l).length;
        const fp = pairs.filter((p) => p.pred === l && p.gold !== l).length;
        const fn = pairs.filter((p) => p.pred !== l && p.gold === l).length;
        const precision = tp + fp ? tp / (tp + fp) : 0;
        const recall = tp + fn ? tp / (tp + fn) : 0;
        const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
        out[`f1:${label}`] = f1;
        f1Sum += f1;
      }
      out.macroF1 = labels.size ? f1Sum / labels.size : 0;
      out.invalidLabelRate = pairs.length ? pairs.filter((p) => p.pred === undefined).length / pairs.length : 0;
      return out;
    },
  };
}
