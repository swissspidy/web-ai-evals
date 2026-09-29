import type { BackendSpec, TaskDefinition, TaskResponse } from '@web-ai-evals/core';
import { BrowserSession, type BrowserChannel, type BrowserConfig } from '@web-ai-evals/runner';
import os from 'node:os';
import path from 'node:path';

/**
 * Promptfoo custom provider: sends each prompt through a backend running in a
 * real browser tab (Chrome/Edge built-in AI, WebLLM, Transformers.js).
 *
 * promptfooconfig.yaml:
 *   providers:
 *     - id: file://node_modules/@web-ai-evals/promptfoo/dist/provider.js
 *       label: gemini-nano
 *       config:
 *         browser: chrome                 # or { channel, headless, presets, ... }
 *         backend: { kind: prompt-api }
 *
 * One browser session is shared by every provider instance that uses the same
 * browser id; calls are serialized (one GPU job at a time) and the browser
 * closes after `idleCloseMs` without calls so promptfoo can exit.
 */
export interface ProviderConfig {
  browser?: BrowserConfig | BrowserChannel;
  backend: Omit<BackendSpec, 'id'> & { id?: string };
  /** Task used to wrap the prompt. Default: { type: 'generate', prompt: '{{text}}' }. */
  task?: TaskDefinition;
  profilesDir?: string;
  port?: number;
  timeoutMs?: number;
  loadTimeoutMs?: number;
  retries?: number;
  idleCloseMs?: number;
}

interface ProviderResponse {
  output?: string;
  error?: string;
  latencyMs?: number;
  tokenUsage?: { prompt?: number; completion?: number; total?: number; numRequests?: number };
  metadata?: Record<string, unknown>;
  cached?: boolean;
}

interface SharedSession {
  session: Promise<BrowserSession>;
  queue: Promise<unknown>;
  loadedKey?: string;
  idle?: NodeJS.Timeout;
  users: number;
}

const sessions = new Map<string, SharedSession>();

function browserConfig(b: ProviderConfig['browser']): BrowserConfig & { id: string } {
  const cfg: BrowserConfig = typeof b === 'string' || b === undefined ? { channel: b ?? 'chrome' } : b;
  return { ...cfg, id: cfg.id ?? cfg.channel };
}

export default class WebAIEvalsProvider {
  readonly config: ProviderConfig;
  private readonly providerId: string;
  private readonly spec: BackendSpec;
  private readonly task: TaskDefinition;
  private readonly browser: BrowserConfig & { id: string };

  constructor(options: { id?: string; config: ProviderConfig }) {
    if (!options?.config?.backend?.kind) throw new Error('web-ai-evals provider: config.backend.kind is required');
    this.config = options.config;
    this.browser = browserConfig(this.config.browser);
    this.spec = { ...this.config.backend, id: this.config.backend.id ?? `${this.config.backend.kind}${this.config.backend.model ? `:${this.config.backend.model}` : ''}` };
    this.task = this.config.task ?? { type: 'generate', prompt: '{{text}}' };
    this.providerId = options.id ?? `web-ai-evals:${this.browser.id}:${this.spec.id}`;
  }

  id(): string {
    return this.providerId;
  }

  private shared(): SharedSession {
    let s = sessions.get(this.browser.id);
    if (!s) {
      s = {
        session: BrowserSession.open({
          browser: this.browser,
          profilesDir: this.config.profilesDir ?? path.join(os.homedir(), '.cache', 'web-ai-evals', 'profiles'),
          port: this.config.port ?? 47831,
          log: process.env.WAE_DEBUG ? (m) => console.error(m) : undefined,
        }),
        queue: Promise.resolve(),
        users: 0,
      };
      sessions.set(this.browser.id, s);
    }
    return s;
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    const shared = this.shared();
    clearTimeout(shared.idle);
    shared.users++;
    const job = shared.queue.then(() => this.runSerialized(shared, prompt));
    shared.queue = job.catch(() => undefined);
    try {
      return await job;
    } finally {
      shared.users--;
      if (shared.users === 0) {
        shared.idle = setTimeout(() => void closeSession(this.browser.id), this.config.idleCloseMs ?? 3000);
      }
    }
  }

  private async runSerialized(shared: SharedSession, prompt: string): Promise<ProviderResponse> {
    let session: BrowserSession;
    try {
      session = await shared.session;
    } catch (err) {
      sessions.delete(this.browser.id);
      return { error: `could not launch ${this.browser.id}: ${(err as Error).message.split('\n')[0]}` };
    }
    const key = JSON.stringify([this.spec, this.task]);
    let loadMs: number | undefined;
    if (shared.loadedKey !== key) {
      shared.loadedKey = undefined;
      const load = await session.load(this.spec, this.task, { timeoutMs: this.config.loadTimeoutMs });
      if (load.status !== 'ok') return { error: `${this.spec.id} ${load.status}: ${load.error ?? load.availabilityBefore.reason ?? ''}` };
      shared.loadedKey = key;
      loadMs = load.loadMs;
    }
    const res: TaskResponse & { attempts: number } = await session.run(
      { exampleId: 'promptfoo', task: this.task, input: { text: prompt }, generation: this.spec.generation },
      { timeoutMs: this.config.timeoutMs ?? 120_000, retries: this.config.retries ?? 0 },
    );
    const t = res.timings;
    const metadata = {
      backend: this.spec.id,
      browser: this.browser.id,
      ttftMs: t.ttftMs,
      tokensPerSecond: t.tokensPerSecond,
      tokenCountSource: t.tokenCountSource,
      loadMs,
      attempts: res.attempts,
    };
    if (res.status !== 'ok') return { error: `${res.status}: ${res.error ?? ''}`, latencyMs: t.totalMs, metadata };
    return {
      output: res.output ?? '',
      latencyMs: Math.round(t.totalMs),
      tokenUsage: { completion: t.outputTokens, prompt: t.inputTokens, total: (t.outputTokens ?? 0) + (t.inputTokens ?? 0) || undefined, numRequests: 1 },
      metadata,
      cached: false,
    };
  }
}

async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s || s.users > 0) return;
  sessions.delete(id);
  await (await s.session.catch(() => undefined))?.close();
}

/** Close every browser opened by the provider (for programmatic use). */
export async function closeAll(): Promise<void> {
  await Promise.all([...sessions.keys()].map(closeSession));
}
