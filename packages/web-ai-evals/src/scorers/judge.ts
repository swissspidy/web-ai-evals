import { references, type Scorer } from './types.js';

export interface JudgeOptions {
  name?: string;
  /** 'anthropic' (default) or any OpenAI-compatible chat completions endpoint. */
  provider?: 'anthropic' | 'openai';
  model?: string;
  /** Env var holding the API key. Keys are never read from configs. */
  apiKeyEnv?: string;
  baseUrl?: string;
  /** Grading rubric. The judge answers with a 1–5 score, normalized to 0..1. */
  rubric?: string;
  maxTokens?: number;
}

const DEFAULT_RUBRIC = `Rate the RESPONSE to the TASK on a 1-5 scale:
5 = fully correct, complete and faithful; 4 = minor issues; 3 = partially correct;
2 = mostly wrong or unfaithful; 1 = wrong, empty or off-task.
If a REFERENCE is given, use it as a guide to correctness, not as the only acceptable answer.`;

/**
 * LLM-as-judge. Runs in Node (never in the page) so API keys stay out of the
 * browser. Calls are sequential per example; cache results by rescoring stored runs.
 */
export function llmJudge(opts: JudgeOptions = {}): Scorer {
  const provider = opts.provider ?? 'anthropic';
  const model = opts.model ?? (provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4.1-mini');
  const keyEnv = opts.apiKeyEnv ?? (provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY');
  return {
    name: opts.name ?? 'judge',
    async score({ output, input, example, task }) {
      const key = process.env[keyEnv];
      if (!key) throw new Error(`llmJudge: set ${keyEnv}`);
      const refs = references(example.expected);
      const prompt = [
        opts.rubric ?? DEFAULT_RUBRIC,
        `TASK (${task.type}):\n${input.text}`,
        refs.length ? `REFERENCE:\n${refs.join('\n---\n')}` : '',
        `RESPONSE:\n${output}`,
        'Reply with a JSON object: {"score": <1-5>, "reason": "<one sentence>"}',
      ]
        .filter(Boolean)
        .join('\n\n');
      const text = provider === 'anthropic' ? await callAnthropic(key, model, prompt, opts) : await callOpenAI(key, model, prompt, opts);
      const match = /"score"\s*:\s*([1-5](?:\.\d+)?)/.exec(text) ?? /\b([1-5])\b/.exec(text);
      if (!match) throw new Error(`llmJudge: could not parse score from "${text.slice(0, 200)}"`);
      const raw = Number(match[1]);
      return { score: (raw - 1) / 4, detail: { raw, response: text.slice(0, 500), model } };
    },
  };
}

async function callAnthropic(key: string, model: string, prompt: string, opts: JudgeOptions): Promise<string> {
  const res = await fetch(`${opts.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: opts.maxTokens ?? 200, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`llmJudge: Anthropic API ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { content: { type: string; text?: string }[] };
  return body.content.map((c) => c.text ?? '').join('');
}

async function callOpenAI(key: string, model: string, prompt: string, opts: JudgeOptions): Promise<string> {
  const res = await fetch(`${opts.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: opts.maxTokens ?? 200, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`llmJudge: OpenAI-compatible API ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return body.choices[0]?.message.content ?? '';
}
