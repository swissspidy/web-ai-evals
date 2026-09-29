# ADR 0001: Architecture — orchestrator/page split, backend adapters, result schema

- Status: Accepted
- Date: 2026-09-29

## Context

We want to evaluate LLM tasks where they actually run for Web AI: inside a
browser tab, on the user's hardware. The execution targets are:

- Built-in AI in Chrome and Edge: Prompt API (`LanguageModel`, Gemini Nano in
  Chrome, Phi-4-mini in Edge), Summarizer, Writer, Rewriter, Translator, and
  experimental classification.
- In-page runtimes: WebLLM (WebGPU) and Transformers.js (WebGPU and Wasm).

Quality and speed depend on browser, channel, backend, quantization and
hardware. Built-in models also change silently when the browser updates, so a
result is meaningless unless it carries the environment it was produced in.

Constraints that shape the design:

1. Models must run in a real browser, with a GPU if there is one. Node cannot
   host the Prompt API, and WebGPU in Node differs from WebGPU in Chrome.
2. Everything else — reading datasets, scoring (including LLM-as-judge calls to
   cloud APIs, which need secrets), storing and diffing results — is easier and
   safer in Node. API keys must never reach the page.
3. Model downloads are large (Gemini Nano is several GB, WebLLM models 1–5 GB).
   They have to survive across runs, so browser profiles must be persistent and
   the page origin must be stable (Cache API / OPFS storage is per origin).
4. GPU work from two runs at once corrupts timing. One browser, one backend and
   one example at a time.
5. The browser APIs are still moving. Adapters must feature-detect and report
   "unavailable" instead of crashing the run.

## Decision

### 1. Two halves: a Node orchestrator and an in-page runtime

```
┌────────────────────── Node: @web-ai-evals/runner ─────────────────────┐
│ config (datasets × backends × browsers)                               │
│   │                                                                   │
│   ├─ static server on 127.0.0.1:<fixed port>  ──serves──┐             │
│   ├─ Playwright launchPersistentContext(profile, channel)│             │
│   │     (one browser at a time)                          ▼             │
│   │            ┌──────────── Browser tab ─────────────────────────┐   │
│   │  evaluate  │ @web-ai-evals/page-runtime  (window.__wae)       │   │
│   │ ─────────▶ │  environment() → Environment                     │   │
│   │            │  load(backendSpec) → LoadReport  ──progress──▶   │   │
│   │            │  run(example) → ExampleOutput (timings, output)  │   │
│   │ ◀───────── │  adapters: prompt-api | summarizer | writer |    │   │
│   │  results   │   rewriter | translator | classifier | webllm |  │   │
│   │            │   transformers (webgpu|wasm)                     │   │
│   │            └──────────────────────────────────────────────────┘   │
│   ├─ scorers (@web-ai-evals/scorers) run in Node, incl. LLM judge     │
│   └─ writes results/<runId>.json  →  @web-ai-evals/report (HTML/diff) │
└───────────────────────────────────────────────────────────────────────┘
```

- **Page runtime** is a browser bundle (built with esbuild) that exposes a small
  RPC surface on `window.__wae`: `environment()`, `availability(spec)`,
  `load(spec)`, `run(request)`, `unload()`. It measures time itself with
  `performance.now()` so Node↔page latency never pollutes TTFT or throughput.
- **Runner** is the only thing that knows about configs, files, retries,
  timeouts and scoring. It drives the page with `page.evaluate` and receives
  progress events through `page.exposeBinding`. Examples are streamed one at a
  time, so a timeout or crash affects one example and the runner can reload the
  page and continue.
- The page is served from `http://127.0.0.1:<port>` with a **fixed default
  port**. `localhost` is a secure context (required by WebGPU and built-in
  AI), and a fixed origin keeps Cache API/IndexedDB model caches valid across
  runs. The server sets COOP/COEP so Wasm threads work.
- Browsers are launched with `launchPersistentContext` using a profile per
  browser channel under `~/.cache/web-ai-evals/profiles/`. Playwright's default
  `--disable-component-update` and `--disable-background-networking` are
  removed, because the component updater is how Chrome downloads Gemini Nano.
- Headful is the default. Built-in AI availability in headless mode is checked
  per run and recorded; headless can be enabled per browser.

Alternatives considered:

- *Everything in the page, results posted to a server.* Simpler for a future
  public/crowdsourced benchmark, but puts judge secrets in reach of the page and
  makes retries and timeouts harder. The page runtime is kept independent of
  the runner so the crowdsourced version can reuse it later with a different
  driver.
- *Puppeteer / CDP directly.* Playwright gives Chrome channels and Edge with one
  API and handles persistent contexts; we can still open a CDP session when we
  need GPU info or memory.

### 2. Backend adapter interface

A backend is described by a serializable **`BackendSpec`** that crosses the
Node→page boundary:

```ts
interface BackendSpec {
  id: string;            // unique label in reports, e.g. "gemma-2b-webllm"
  kind: BackendKind;     // 'prompt-api' | 'summarizer' | 'writer' | 'rewriter'
                         // | 'translator' | 'classifier' | 'webllm' | 'transformers'
  model?: string;        // model id where the backend takes one
  device?: 'webgpu' | 'wasm';
  options?: Record<string, unknown>; // passed through to the underlying API
}
```

In the page, each kind has an **adapter**:

```ts
interface BackendAdapter {
  kind: BackendKind;
  tasks: TaskType[];                                  // what it can run
  availability(spec): Promise<Availability>;          // never throws
  load(spec, ctx: { onProgress, signal }): Promise<LoadedBackend>;
}

interface LoadedBackend {
  info: ModelInfo;                                    // model id/version, dtype…
  run(req: TaskRequest, ctx: { signal, onChunk }): Promise<TaskResponse>;
  dispose(): Promise<void>;
}
```

- `availability()` maps every API's own vocabulary to one enum:
  `available | downloadable | downloading | unavailable` plus a reason.
- `run()` receives a **task request**, not a raw prompt: `{ task: 'generate' |
  'summarize' | 'write' | 'rewrite' | 'translate' | 'classify', input, system?,
  options }`. A chat model can serve every task through a prompt template; a
  task API (Summarizer, Translator) only serves its own. This is what lets one
  dataset run across a task API and general LLMs.
- Adapters call `onChunk(text)` for each streamed **delta**. The runtime
  timestamps the first non-empty chunk (TTFT) and the last one, so every backend
  gets identical timing semantics.
- Adapters return token counts when the backend knows them (WebLLM usage,
  Transformers.js tokenizer, Prompt API `measureInputUsage`), and say so via
  `tokenCountSource: 'exact' | 'chunks' | 'estimate'`, so throughput numbers
  are never silently compared across different definitions.
- Adapters are thin and written against the official APIs. The Vercel AI SDK
  community provider (`@browser-ai/*`) is an allowed implementation detail for
  an adapter, not a dependency of the interface.

### 3. Result schema

One JSON file per run (`results/<runId>.json`), versioned with
`schemaVersion`. Its shape (see `packages/core/src/types.ts` for the source of
truth):

```ts
interface RunFile {
  schemaVersion: 1;
  runId: string; startedAt: string; finishedAt: string;
  tool: { name: '@web-ai-evals/runner'; version: string };
  config: { name?: string; datasets: DatasetRef[]; };
  cells: CellResult[];         // one per dataset × backend × browser
}

interface CellResult {
  dataset: DatasetRef;         // id, path, sha256 of contents, example count
  backend: BackendSpec;
  environment: Environment;    // captured in the page + by the runner
  load: LoadReport;            // availability before, download, cold start ms
  results: ExampleResult[];
  summary: CellSummary;        // aggregate scores and latency percentiles
}

interface ExampleResult {
  exampleId: string;
  phase: 'cold' | 'warm';      // first example after load is 'cold'
  repeat: number;
  status: 'ok' | 'error' | 'timeout' | 'unavailable';
  output?: string; error?: string; attempts: number;
  timings: { ttftMs?; totalMs; outputTokens?; tokensPerSecond?;
             tokenCountSource? };
  memory?: { jsHeapUsedBytes?; };
  scores: Record<string, number>;  // scorer name → 0..1 (or metric value)
}

interface Environment {
  browser: { name; channel; version; userAgent; headless };
  os: { platform; release; arch };
  hardware: { cpuModel?; cores; memoryBytes; deviceMemoryGb? };
  gpu?: { vendor; architecture; device; description; isFallbackAdapter? };
  backend: { kind; model?; modelVersion?; dtype?; device? };
  flags: string[];             // browser args and enabled features
}
```

Scores are computed in Node, after the page returns the output, so rescoring a
stored run with a new scorer never requires the browser again.

### 4. Datasets

JSONL, one example per line: `{ "id", "input", "expected"?, "meta"? }`, where
`input` is a string or `{ text, context?, sourceLanguage?, targetLanguage?,
labels? }`. The task type and prompt template live in the suite config, not in
the data, so the same data can drive a Summarizer and a chat model.

## Consequences

- The page runtime can be reused by a future hosted/crowdsourced benchmark with
  a different driver.
- Every metric is measured in the same place (the page) with the same clock.
- Rescoring and report generation are offline and cheap.
- Cost: an RPC boundary, and results are only as rich as `page.evaluate` can
  serialize (plain JSON — no streams across the boundary; progress goes
  through an exposed binding).
- Persistent profiles mean the first run on a new machine is slow and
  download-bound; the load report records this as `downloadMs` so it is not
  mistaken for inference time.
