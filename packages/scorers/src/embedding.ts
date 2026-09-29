import { references, type Scorer } from './types.js';

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Transformers.js feature extraction in Node as the default embedder
 * (`@huggingface/transformers` must be installed; it is an optional peer).
 */
export function transformersEmbedder(model = 'Xenova/all-MiniLM-L6-v2'): EmbedFn {
  let extractor: Promise<(texts: string[], o: object) => Promise<{ tolist(): number[][] }>> | undefined;
  return async (texts) => {
    extractor ??= import('@huggingface/transformers' as string).then(
      (t: { pipeline: (task: string, model: string) => Promise<never> }) => t.pipeline('feature-extraction', model),
    );
    const out = await (await extractor)(texts, { pooling: 'mean', normalize: true });
    return out.tolist();
  };
}

/** Max cosine similarity between the output and any reference, clamped to 0..1. */
export function embeddingSimilarity(opts: { name?: string; embed?: EmbedFn } = {}): Scorer {
  const embed = opts.embed ?? transformersEmbedder();
  return {
    name: opts.name ?? 'similarity',
    async score({ output, example }) {
      const refs = references(example.expected);
      if (!refs.length) throw new Error('embeddingSimilarity needs example.expected');
      const [o, ...r] = await embed([output, ...refs]);
      return Math.max(0, ...r.map((v) => cosine(o, v)));
    },
  };
}
