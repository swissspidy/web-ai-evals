import type {
  AvailabilityReport,
  BackendSpec,
  LoadReport,
  MemorySample,
  PageEnvironment,
  ProgressEvent,
  TaskDefinition,
  TaskRequest,
  TaskResponse,
} from '../core/index.js';
import { adapters, type LoadedBackend } from './adapters/index.js';
import { errorMessage, g } from './adapters/types.js';
import { captureEnvironment } from './env.js';

/**
 * In-page runtime. Exposes `window.__wae` for a driver (the Node runner, or a
 * future hosted benchmark page). All timing happens here with performance.now().
 */

type PageLoadReport = Omit<LoadReport, 'availabilityBefore' | 'downloaded' | 'coldStarts'>;

let loaded: { spec: BackendSpec; backend: LoadedBackend } | undefined;
let armed: { spec: BackendSpec; task: TaskDefinition } | undefined;
let pendingLoad: Promise<PageLoadReport> | undefined;
let current: AbortController | undefined;

const log = (msg: string) => {
  const el = document.getElementById('log');
  if (el) el.textContent = `${new Date().toISOString().slice(11, 19)} ${msg}\n${el.textContent ?? ''}`.slice(0, 5000);
};

function emitProgress(event: ProgressEvent) {
  g.__waeProgress?.(event);
  const el = document.getElementById('progress');
  if (el) el.textContent = `${Math.round(event.progress * 100)}% ${event.file ?? event.text ?? ''}`;
}

async function availability(spec: BackendSpec, task: TaskDefinition): Promise<AvailabilityReport> {
  const adapter = adapters[spec.kind];
  if (!adapter) return { availability: 'unavailable', reason: `unknown backend kind "${spec.kind}"` };
  if (!adapter.tasks.includes(task.type)) {
    return { availability: 'unavailable', reason: `${spec.kind} does not support task "${task.type}"` };
  }
  return adapter.availability(spec, task);
}

async function load(spec: BackendSpec, task: TaskDefinition): Promise<PageLoadReport> {
  await unload();
  const adapter = adapters[spec.kind];
  const controller = new AbortController();
  const t0 = performance.now();
  let downloadEnd: number | undefined;
  let sawPartial = false;
  log(`loading ${spec.id} (${spec.kind}${spec.model ? ` ${spec.model}` : ''})`);
  try {
    const backend = await adapter.load(spec, task, {
      signal: controller.signal,
      onProgress(event) {
        if (event.progress < 1) sawPartial = true;
        if (event.progress >= 1 && downloadEnd === undefined) downloadEnd = performance.now();
        emitProgress(event);
      },
    });
    const loadMs = performance.now() - t0;
    loaded = { spec, backend };
    log(`loaded ${spec.id} in ${loadMs.toFixed(0)} ms`);
    return {
      status: 'ok',
      loadMs,
      downloadMs: sawPartial && downloadEnd !== undefined ? downloadEnd - t0 : undefined,
      model: backend.info,
    };
  } catch (err) {
    log(`load failed: ${errorMessage(err)}`);
    return { status: 'error', loadMs: performance.now() - t0, error: errorMessage(err) };
  }
}

/**
 * Built-in AI create() needs transient user activation while a model is
 * downloadable. The driver arms a load, then clicks #wae-activate with a
 * trusted input event; the click handler starts the load.
 */
function armLoad(spec: BackendSpec, task: TaskDefinition): void {
  armed = { spec, task };
  pendingLoad = undefined;
}

function onActivate() {
  if (!armed) return;
  const { spec, task } = armed;
  armed = undefined;
  pendingLoad = load(spec, task);
}

async function awaitLoad(): Promise<PageLoadReport> {
  if (!pendingLoad) throw new Error('no load in progress: call armLoad() and click #wae-activate first');
  return pendingLoad;
}

function sampleMemory(): MemorySample | undefined {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return m ? { jsHeapUsedBytes: m.usedJSHeapSize, jsHeapTotalBytes: m.totalJSHeapSize } : undefined;
}

async function measureMemory(): Promise<MemorySample | undefined> {
  const base = sampleMemory();
  const fn = (performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> })
    .measureUserAgentSpecificMemory;
  if (!crossOriginIsolated || typeof fn !== 'function') return base;
  try {
    const res = await fn.call(performance);
    return { ...base, uaSpecificBytes: res.bytes };
  } catch {
    return base;
  }
}

async function run(request: TaskRequest): Promise<TaskResponse> {
  if (!loaded) return { status: 'error', error: 'no backend loaded', timings: { totalMs: 0 } };
  const controller = new AbortController();
  current = controller;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (request.timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('example timed out', 'TimeoutError'));
    }, request.timeoutMs);
  }

  let first: number | undefined;
  let last: number | undefined;
  let chunks = 0;
  let streamed = '';
  const t0 = performance.now();
  try {
    const res = await loaded.backend.run(request, {
      signal: controller.signal,
      onChunk(delta) {
        if (!delta) return;
        const now = performance.now();
        if (first === undefined && delta.trim()) first = now;
        last = now;
        chunks++;
        streamed += delta;
      },
    });
    const end = performance.now();
    clearTimeout(timer);
    const output = res.output ?? streamed;

    // Token counting happens after the timed region.
    let outputTokens = res.outputTokens;
    let source = res.tokenCountSource;
    if (outputTokens === undefined && loaded.backend.countTokens && output) {
      outputTokens = await loaded.backend.countTokens(output);
      if (outputTokens !== undefined) source = 'tokenizer';
    }
    if (outputTokens === undefined && chunks > 0) {
      outputTokens = chunks;
      source = 'chunks';
    }
    const ttftMs = first !== undefined ? first - t0 : undefined;
    const decodeMs = first !== undefined && last !== undefined ? last - first : 0;
    const tokensPerSecond = outputTokens && outputTokens > 1 && chunks > 1 && decodeMs > 0 ? ((outputTokens - 1) / decodeMs) * 1000 : undefined;

    return {
      status: 'ok',
      output,
      timings: {
        ttftMs,
        totalMs: end - t0,
        outputTokens,
        inputTokens: res.inputTokens,
        tokensPerSecond,
        tokenCountSource: source,
        chunks,
      },
      memory: sampleMemory(),
      extra: res.extra,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      status: timedOut ? 'timeout' : 'error',
      output: streamed || undefined,
      error: errorMessage(err),
      timings: { totalMs: performance.now() - t0, ttftMs: first !== undefined ? first - t0 : undefined, chunks },
      memory: sampleMemory(),
    };
  } finally {
    if (current === controller) current = undefined;
  }
}

function abort(): void {
  current?.abort(new DOMException('aborted by driver', 'AbortError'));
}

async function unload(): Promise<void> {
  if (!loaded) return;
  const { backend } = loaded;
  loaded = undefined;
  await backend.dispose().catch(() => {});
}

const api = {
  version: 1,
  environment: (): Promise<PageEnvironment> => captureEnvironment(),
  availability,
  load,
  armLoad,
  awaitLoad,
  run,
  abort,
  unload,
  measureMemory,
};

export type WaeApi = typeof api;

g.__wae = api;
document.getElementById('wae-activate')?.addEventListener('click', onActivate);
document.documentElement.dataset.waeReady = 'true';
log('runtime ready');
