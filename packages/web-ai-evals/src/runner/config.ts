import type { BackendSpec, TaskDefinition } from '../core/index.js';
import type { Scorer } from '../scorers/index.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Playwright channels plus the bundled Chromium. */
export type BrowserChannel =
  | 'chrome'
  | 'chrome-beta'
  | 'chrome-dev'
  | 'chrome-canary'
  | 'msedge'
  | 'msedge-beta'
  | 'msedge-dev'
  | 'msedge-canary'
  | 'chromium';

export interface BrowserConfig {
  /** Unique id, used for the profile directory and in reports. Defaults to the channel. */
  id?: string;
  channel: BrowserChannel;
  /** Headful by default: built-in AI is not guaranteed in headless mode. */
  headless?: boolean;
  executablePath?: string;
  /** Extra command-line args. */
  args?: string[];
  /** Added to --enable-features. */
  enableFeatures?: string[];
  /** Added to --disable-features (on top of the harmless defaults we keep from Playwright). */
  disableFeatures?: string[];
  /** Profile directory. Defaults to `<profilesDir>/<id>`. */
  profileDir?: string;
  /** HTTP(S) proxy for the browser. Defaults to $HTTPS_PROXY when set. Use `false` to disable. */
  proxy?: string | false;
  /** Chrome flag presets to apply, see `FLAG_PRESETS` in browsers.ts. */
  presets?: string[];
}

export interface SuiteConfig {
  id: string;
  /** Path to a JSONL dataset, relative to the config file. */
  dataset: string;
  task: TaskDefinition;
  /** First scorer is the primary quality metric in reports. */
  scorers: Scorer[];
  /** Backend ids to run this suite on. Defaults to every backend that supports the task. */
  backends?: string[];
  /** Only run the first N examples. */
  limit?: number;
  license?: string;
  description?: string;
}

export interface RunOptions {
  /** Per-example timeout. Default 120 s. */
  timeoutMs?: number;
  /** Model load timeout, including download. Default 60 min. */
  loadTimeoutMs?: number;
  /** Retries for errored/timed out examples. Default 1. */
  retries?: number;
  /** Times each example is run (warm). Default 1. */
  repeats?: number;
  /** Extra cold starts to measure per cell, each in a fresh page. Default 0. */
  coldStarts?: number;
  /** Examples to run and discard before measuring (e.g. shader warm-up). Default 0. */
  warmup?: number;
  /** Fixed port for the page runtime. A fixed origin keeps model caches valid. Default 47831. */
  port?: number;
  /** Where profiles live. Default ~/.cache/web-ai-evals/profiles. */
  profilesDir?: string;
  /** Output directory for run files. Default ./results relative to the config. */
  outDir?: string;
}

export interface EvalConfig {
  name?: string;
  browsers: Array<BrowserConfig | BrowserChannel>;
  backends: BackendSpec[];
  suites: SuiteConfig[];
  run?: RunOptions;
  /** Free-form notes copied into the run file. */
  notes?: string[];
}

export interface ResolvedConfig extends EvalConfig {
  browsers: Array<BrowserConfig & { id: string }>;
  run: Required<Omit<RunOptions, 'outDir' | 'profilesDir'>> & { outDir: string; profilesDir: string };
  baseDir: string;
}

export function defineConfig(config: EvalConfig): EvalConfig {
  return config;
}

export function resolveConfig(config: EvalConfig, baseDir: string): ResolvedConfig {
  const browsers = config.browsers.map((b) => {
    const bc = typeof b === 'string' ? { channel: b } : b;
    return { ...bc, id: bc.id ?? bc.channel };
  });
  const ids = new Set<string>();
  for (const b of browsers) {
    if (ids.has(b.id)) throw new Error(`duplicate browser id "${b.id}"`);
    ids.add(b.id);
  }
  const backendIds = new Set<string>();
  for (const b of config.backends) {
    if (backendIds.has(b.id)) throw new Error(`duplicate backend id "${b.id}"`);
    backendIds.add(b.id);
  }
  for (const s of config.suites) {
    for (const id of s.backends ?? []) if (!backendIds.has(id)) throw new Error(`suite "${s.id}" references unknown backend "${id}"`);
    if (!s.scorers.length) throw new Error(`suite "${s.id}" needs at least one scorer`);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
  const r = config.run ?? {};
  return {
    ...config,
    browsers,
    baseDir,
    run: {
      timeoutMs: r.timeoutMs ?? 120_000,
      loadTimeoutMs: r.loadTimeoutMs ?? 60 * 60_000,
      retries: r.retries ?? 1,
      repeats: r.repeats ?? 1,
      coldStarts: r.coldStarts ?? 0,
      warmup: r.warmup ?? 0,
      port: r.port ?? 47831,
      profilesDir: r.profilesDir ? path.resolve(baseDir, r.profilesDir) : path.join(home, '.cache', 'web-ai-evals', 'profiles'),
      outDir: path.resolve(baseDir, r.outDir ?? 'results'),
    },
  };
}

/** Load an evals config (.ts, .mts, .js, .mjs). Node >= 24 strips TypeScript types natively. */
export async function loadConfig(file: string): Promise<ResolvedConfig> {
  const abs = path.resolve(file);
  const mod = (await import(pathToFileURL(abs).href)) as { default?: EvalConfig };
  if (!mod.default) throw new Error(`${file} must export a config as default export`);
  return resolveConfig(mod.default, path.dirname(abs));
}
