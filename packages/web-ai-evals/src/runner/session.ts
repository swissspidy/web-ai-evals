import type {
  AvailabilityReport,
  BackendSpec,
  Environment,
  LoadReport,
  ModelInfo,
  PageEnvironment,
  ProgressEvent,
  TaskDefinition,
  TaskRequest,
  TaskResponse,
} from '../core/index.js';
import type { Page } from 'playwright';
import { launchBrowser, type LaunchedBrowser } from './browsers.js';
import type { BrowserConfig } from './config.js';
import { builtInModelVersions, dirBytes, hostInfo } from './host.js';
import { startRuntimeServer, type RuntimeServer } from './server.js';

export interface SessionOptions {
  browser: BrowserConfig & { id: string };
  profilesDir: string;
  /** Port for the runtime server. Ignored when `serverUrl` is given. */
  port?: number;
  /** Reuse an already running runtime server. */
  serverUrl?: string;
  log?: (msg: string) => void;
}

export interface LoadOptions {
  timeoutMs?: number;
  /** Retry the load when no progress event arrives for this long. Default 5 min. */
  stallMs?: number;
  /** Wait between retries while a model is still installing. Default 15 s. */
  installRetryMs?: number;
  onProgress?: (event: ProgressEvent) => void;
}

export interface RunRequestOptions {
  /** Timeout enforced inside the page; the runner adds a grace period for hung pages. */
  timeoutMs?: number;
  retries?: number;
}

type PageLoadReport = Omit<LoadReport, 'availabilityBefore' | 'downloaded' | 'coldStarts'>;

/** Errors Chrome's Translator returns while its runtime or language pack is still installing. */
const INSTALLING_ERROR = /Unable to create translator for the given source and target language|translation service count exceeded/i;
const INSTALL_RETRY_MS = 15_000;
const MAX_INSTALL_RETRIES = 20;

const BACKEND_DEAD = /device (was )?lost|disposed|Instance reference no longer exists|session.*destroyed|crashed/i;

const BUILT_IN_KINDS = new Set(['prompt-api', 'summarizer', 'writer', 'rewriter', 'translator']);

/**
 * One browser with the page runtime loaded. This is the programmatic API for
 * integrations (Promptfoo provider, Belay): open a session, load a backend,
 * run requests, close.
 */
export class BrowserSession {
  page!: Page;
  private progressHandler?: (e: ProgressEvent) => void;
  private current?: { spec: BackendSpec; task: TaskDefinition };
  private pageEnv?: PageEnvironment;

  private constructor(
    readonly options: SessionOptions,
    readonly browser: LaunchedBrowser,
    readonly url: string,
    private readonly server?: RuntimeServer,
  ) {}

  static async open(options: SessionOptions): Promise<BrowserSession> {
    let server: RuntimeServer | undefined;
    let url = options.serverUrl;
    if (!url) {
      server = await startRuntimeServer(options.port ?? 47831);
      url = server.url;
    }
    let browser: LaunchedBrowser;
    try {
      browser = await launchBrowser(options.browser, options.profilesDir);
    } catch (err) {
      await server?.close();
      throw err;
    }
    const session = new BrowserSession(options, browser, url, server);
    browser.context.on('close', () => {
      session.closed = true;
    });
    try {
      await browser.context.exposeBinding('__waeProgress', (_source, event: ProgressEvent) => session.progressHandler?.(event));
      await session.openPage();
    } catch (err) {
      // Don't leave a browser holding the profile lock (or the server) behind.
      await session.close();
      throw err;
    }
    return session;
  }

  private log(msg: string) {
    this.options.log?.(`[${this.options.browser.id}] ${msg}`);
  }

  private async openPage(): Promise<void> {
    const pages = this.browser.context.pages();
    const page = pages.find((p) => p.url() === 'about:blank') ?? (await this.browser.context.newPage());
    for (const p of this.browser.context.pages()) if (p !== page) await p.close().catch(() => {});
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') this.log(`console.${m.type()}: ${m.text()}`);
    });
    page.on('crash', () => this.log('page crashed'));
    await page.goto(this.url);
    await page.waitForFunction(() => document.documentElement.dataset.waeReady === 'true');
    this.page = page;
  }

  /** Replace the page (after a hang or crash) and reload the current backend. */
  async resetPage(): Promise<void> {
    const old = this.page;
    await old?.close({ runBeforeUnload: false }).catch(() => {});
    await this.openPage();
    if (this.current) await this.load(this.current.spec, this.current.task);
  }

  async pageEnvironment(): Promise<PageEnvironment> {
    this.pageEnv ??= await this.page.evaluate(() => window.__wae.environment());
    return this.pageEnv;
  }

  availability(spec: BackendSpec, task: TaskDefinition): Promise<AvailabilityReport> {
    return this.page.evaluate(([s, t]) => window.__wae.availability(s, t), [spec, task] as const);
  }

  /** Load a backend. Provides user activation via a trusted click, as built-in AI requires. */
  async load(spec: BackendSpec, task: TaskDefinition, options: LoadOptions = {}): Promise<LoadReport> {
    const availabilityBefore = await this.availability(spec, task);
    const downloaded = availabilityBefore.availability === 'downloadable' || availabilityBefore.availability === 'downloading';
    if (availabilityBefore.availability === 'unavailable') {
      this.current = undefined;
      return { status: 'unavailable', availabilityBefore, downloaded: false, error: availabilityBefore.reason };
    }
    let lastLogged = -1;
    this.progressHandler = (e) => {
      options.onProgress?.(e);
      const pct = Math.floor(e.progress * 100);
      if (pct >= lastLogged + 10 || (pct === 100 && lastLogged !== 100)) {
        lastLogged = pct;
        this.log(`${spec.id}: ${pct}%${e.totalBytes ? ` of ${(e.totalBytes / 1e6).toFixed(0)} MB` : ''}`);
      }
    };
    this.log(`loading ${spec.id} (availability: ${availabilityBefore.availability})`);
    const timeoutMs = options.timeoutMs ?? 60 * 60_000;
    const stallMs = options.stallMs ?? 5 * 60_000;
    const deadline = Date.now() + timeoutMs;
    let report: PageLoadReport;
    let installRetries = 0;
    for (let attempt = 1; ; attempt++) {
      let lastProgress = Date.now();
      const inner: ((e: ProgressEvent) => void) | undefined = this.progressHandler;
      this.progressHandler = (e) => {
        lastProgress = Date.now();
        inner?.(e);
      };
      await this.page.evaluate(([s, t]) => window.__wae.armLoad(s, t), [spec, task] as const);
      await this.page.click('#wae-activate');
      let timer: NodeJS.Timeout | undefined;
      report = await Promise.race([
        this.page.evaluate(() => window.__wae.awaitLoad()),
        new Promise<PageLoadReport>((resolve) => {
          let lastBytes = -1;
          let lastDiskCheck = 0;
          const check = async () => {
            // Built-in AI only reports progress at 0 and 1, so growth of the profile on disk
            // counts as progress while a model component downloads.
            if (BUILT_IN_KINDS.has(spec.kind) && Date.now() - lastDiskCheck > 30_000) {
              lastDiskCheck = Date.now();
              const bytes = await dirBytes(this.browser.profileDir);
              if (lastBytes >= 0 && bytes !== lastBytes) lastProgress = Date.now();
              lastBytes = bytes;
            }
            if (Date.now() > deadline) return resolve({ status: 'timeout', error: `load timed out after ${timeoutMs} ms` });
            // A create() call issued before the browser has fetched its model manifest can hang
            // without progress events; reloading the page and calling it again recovers.
            if (Date.now() - lastProgress > stallMs) return resolve({ status: 'timeout', error: `no load progress for ${stallMs} ms` });
            timer = setTimeout(() => void check(), 1000);
          };
          timer = setTimeout(() => void check(), 1000);
        }),
      ]).finally(() => clearTimeout(timer));
      this.progressHandler = inner;
      // On first use, Translator.create() fails immediately while Chrome is still installing the
      // TranslateKit runtime and the language pack, instead of waiting for them. Retry (with a
      // fresh user activation) until the install finishes.
      const installing = report.status === 'error' && INSTALLING_ERROR.test(report.error ?? '');
      const retryMs = options.installRetryMs ?? INSTALL_RETRY_MS;
      if (installing && Date.now() + retryMs < deadline && installRetries < MAX_INSTALL_RETRIES) {
        installRetries++;
        this.log(`${spec.id}: ${report.error}; the model is probably still installing, retrying in ${retryMs / 1000} s`);
        await new Promise((r) => setTimeout(r, retryMs));
        continue;
      }
      if (report.status !== 'timeout' || Date.now() > deadline || attempt >= 3 + installRetries) break;
      this.log(`${spec.id}: ${report.error}; reloading the page and retrying (attempt ${attempt + 1})`);
      this.current = undefined;
      await this.resetPage();
    }
    this.progressHandler = undefined;
    this.current = report.status === 'ok' ? { spec, task } : undefined;
    this.log(`${spec.id}: load ${report.status}${report.loadMs ? ` in ${(report.loadMs / 1000).toFixed(1)} s` : ''}${report.error ? ` (${report.error})` : ''}`);
    // Built-in AI fires downloadprogress 0 and 1 even when the model is cached; only report
    // download time when the model was actually missing.
    return { ...report, downloadMs: downloaded ? report.downloadMs : undefined, availabilityBefore, downloaded };
  }

  /** Run one request with a page-side timeout, a Node-side hard timeout and retries. */
  async run(request: TaskRequest, options: RunRequestOptions = {}): Promise<TaskResponse & { attempts: number }> {
    const retries = options.retries ?? 0;
    const timeoutMs = options.timeoutMs ?? request.timeoutMs ?? 120_000;
    let last: TaskResponse | undefined;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      last = await this.runOnce({ ...request, timeoutMs }, timeoutMs + 15_000);
      if (last.status === 'ok' || last.status === 'unavailable') return { ...last, attempts: attempt };
      this.log(`${request.exampleId}: ${last.status} (${last.error ?? ''}), attempt ${attempt}/${retries + 1}`);
      // A lost GPU device or disposed session poisons every later request: reload the backend.
      if (BACKEND_DEAD.test(last.error ?? '')) {
        this.log(`${request.exampleId}: backend looks dead, reloading page and backend`);
        await this.resetPage().catch((e) => this.log(`reset failed: ${(e as Error).message}`));
      }
    }
    return { ...last!, attempts: retries + 1 };
  }

  private async runOnce(request: TaskRequest, hardTimeoutMs: number): Promise<TaskResponse> {
    let timer: NodeJS.Timeout | undefined;
    const hard = new Promise<'hung'>((resolve) => {
      timer = setTimeout(() => resolve('hung'), hardTimeoutMs);
    });
    try {
      const res = await Promise.race([this.page.evaluate((r) => window.__wae.run(r), request), hard]);
      if (res !== 'hung') return res;
      this.log(`${request.exampleId}: page did not respond after ${hardTimeoutMs} ms, resetting page`);
      await this.resetPage();
      return { status: 'timeout', error: `page hung for ${hardTimeoutMs} ms`, timings: { totalMs: hardTimeoutMs } };
    } catch (err) {
      // Page crash or navigation: recover so the next example can run.
      const message = (err as Error).message;
      this.log(`${request.exampleId}: ${message.split('\n')[0]}, resetting page`);
      await this.resetPage().catch((e) => this.log(`reset failed: ${(e as Error).message}`));
      return { status: 'error', error: message.split('\n')[0], timings: { totalMs: 0 } };
    } finally {
      clearTimeout(timer);
    }
  }

  async unload(): Promise<void> {
    this.current = undefined;
    await this.page.evaluate(() => window.__wae.unload()).catch(() => {});
  }

  /** Full environment record for a backend in this browser. */
  async environment(spec: BackendSpec, model?: ModelInfo): Promise<Environment> {
    const env = await this.pageEnvironment();
    const host = hostInfo();
    const cfg = this.options.browser;
    const preferGemma4 = this.browser.flags.some((f) => f.includes('AIApiFoundationalModel:model_version/v4'));
    const builtIn = BUILT_IN_KINDS.has(spec.kind) ? await builtInModelVersions(this.browser.profileDir, { preferGemma4 }) : undefined;
    const brand = env.fullVersionList?.find((b) => /Chrome|Edge|Chromium/.test(b.brand) && !/Not/.test(b.brand));
    return {
      browser: {
        id: cfg.id,
        name: cfg.channel.startsWith('msedge') ? 'Microsoft Edge' : cfg.channel === 'chromium' ? 'Chromium' : 'Google Chrome',
        channel: cfg.channel,
        version: brand?.version ?? this.browser.version,
        userAgent: env.userAgent,
        headless: cfg.headless ?? false,
        fullVersionList: env.fullVersionList,
      },
      os: { platform: host.platform, release: host.release, arch: host.arch, version: env.platformVersion },
      hardware: { cpuModel: host.cpuModel, cores: env.cores, memoryBytes: host.memoryBytes, deviceMemoryGb: env.deviceMemoryGb },
      gpu: env.gpu,
      webgpu: env.webgpu,
      crossOriginIsolated: env.crossOriginIsolated,
      backend: {
        kind: spec.kind,
        model: model?.model ?? spec.model ?? builtIn?.baseModel,
        modelVersion: model?.modelVersion ?? (builtIn?.baseModelVersion ? `${builtIn.baseModelVersion} (component ${builtIn.onDeviceModel})` : builtIn?.onDeviceModel),
        dtype: model?.dtype ?? spec.dtype,
        device: model?.device ?? spec.device,
        details: { ...model?.details, ...(builtIn ? { builtInComponents: builtIn } : {}) },
      },
      flags: this.browser.flags,
      builtInApis: env.builtInApis,
    };
  }

  /** False once the browser process is gone. */
  get alive(): boolean {
    const b = this.browser.context.browser();
    return b ? b.isConnected() : !this.closed;
  }

  private closed = false;

  async close(): Promise<void> {
    this.closed = true;
    await this.browser.context.close().catch(() => {});
    await this.server?.close();
  }
}

declare global {
  interface Window {
    __wae: {
      environment(): Promise<PageEnvironment>;
      availability(spec: BackendSpec, task: TaskDefinition): Promise<AvailabilityReport>;
      armLoad(spec: BackendSpec, task: TaskDefinition): void;
      awaitLoad(): Promise<PageLoadReport>;
      run(request: TaskRequest): Promise<TaskResponse>;
      abort(): void;
      unload(): Promise<void>;
      measureMemory(): Promise<unknown>;
    };
  }
}
