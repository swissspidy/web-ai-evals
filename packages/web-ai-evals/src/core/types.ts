/**
 * Shared types for web-ai-evals. These cross the Node ↔ page boundary, so every
 * type here must be plain JSON (no functions, Dates, Maps or class instances).
 */

export const SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

export type BackendKind =
  | 'prompt-api'
  | 'summarizer'
  | 'writer'
  | 'rewriter'
  | 'translator'
  | 'classifier'
  | 'webllm'
  | 'transformers'
  | 'mock';

export type Device = 'webgpu' | 'wasm' | 'webnn' | 'cpu' | 'auto';

/** Serializable description of a backend. Sent from the runner to the page. */
export interface BackendSpec {
  /** Unique label used in reports, e.g. "gemma3-1b-webllm". */
  id: string;
  kind: BackendKind;
  /** Model id for backends that take one (WebLLM, Transformers.js). */
  model?: string;
  /** Execution device for in-page runtimes. */
  device?: Device;
  /** Quantization / dtype for in-page runtimes, e.g. "q4f16". */
  dtype?: string;
  /** Passed through to the underlying API's create()/pipeline() options. */
  options?: Record<string, unknown>;
  /** Default generation options (maxTokens, temperature, ...). */
  generation?: GenerationOptions;
  /**
   * Runner-side filter: only run this backend in these browser ids (e.g. the
   * Prompt API as "phi-4-mini" only in Edge). Ignored by the page runtime.
   */
  browsers?: string[];
}

export interface GenerationOptions {
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  /** Prompt API only: samplingMode (origin trial / flag). */
  samplingMode?: string;
}

export type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export interface AvailabilityReport {
  availability: Availability;
  /** Why the backend is unavailable, or extra detail. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Tasks and datasets
// ---------------------------------------------------------------------------

export type TaskType = 'generate' | 'summarize' | 'write' | 'rewrite' | 'translate' | 'classify' | 'extract';

/** Structured input. A dataset line may also use a plain string. */
export interface ExampleInput {
  text: string;
  /** Extra context (Summarizer/Writer `context`, or extra prompt context). */
  context?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  /** Candidate labels for classification. */
  labels?: string[];
  /** JSON schema the output must follow (extraction / structured output). */
  schema?: Record<string, unknown>;
}

/** One line of a JSONL dataset. */
export interface Example {
  id: string;
  input: string | ExampleInput;
  /** Reference output: a label, a reference text, a JSON value, or several references. */
  expected?: unknown;
  meta?: Record<string, unknown>;
}

export interface TaskDefinition {
  type: TaskType;
  /**
   * Prompt template for general LLM backends. `{{text}}`, `{{context}}`,
   * `{{labels}}`, `{{sourceLanguage}}`, `{{targetLanguage}}` and `{{schema}}`
   * are replaced. Task APIs (Summarizer, Translator, ...) ignore it.
   */
  prompt?: string;
  /** System prompt for chat backends. */
  system?: string;
  /** Default labels for classification tasks. */
  labels?: string[];
  /** Default language pair for translation tasks. */
  sourceLanguage?: string;
  targetLanguage?: string;
  /** Ask chat backends to constrain output to this JSON schema where supported. */
  responseSchema?: Record<string, unknown>;
  /** Task API options, e.g. { type: 'tldr', length: 'short' } for Summarizer. */
  apiOptions?: Record<string, unknown>;
}

/** What the page runtime receives for one example. */
export interface TaskRequest {
  exampleId: string;
  task: TaskDefinition;
  input: ExampleInput;
  generation?: GenerationOptions;
  /** Wall-clock budget for this request inside the page. */
  timeoutMs?: number;
}

export type TokenCountSource = 'reported' | 'tokenizer' | 'chunks' | 'estimate';

export interface Timings {
  /** Time to first non-empty streamed chunk, from the request start. */
  ttftMs?: number;
  /** Request start to final chunk / resolved promise. */
  totalMs: number;
  outputTokens?: number;
  inputTokens?: number;
  /**
   * Decode throughput: outputTokens / (totalMs - ttftMs). Only set when both
   * are known and the stream produced more than one chunk.
   */
  tokensPerSecond?: number;
  tokenCountSource?: TokenCountSource;
  chunks?: number;
}

/** What the page runtime returns for one example. */
export interface TaskResponse {
  status: 'ok' | 'error' | 'timeout' | 'unavailable';
  output?: string;
  error?: string;
  timings: Timings;
  memory?: MemorySample;
  /** Backend-specific extras (e.g. WebLLM runtime stats, classifier confidences). */
  extra?: Record<string, unknown>;
}

export interface MemorySample {
  jsHeapUsedBytes?: number;
  jsHeapTotalBytes?: number;
  /** performance.measureUserAgentSpecificMemory() total, when cross-origin isolated. */
  uaSpecificBytes?: number;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface GpuInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
  features?: string[];
  /** A small subset of limits that affect model loading. */
  limits?: Record<string, number>;
}

export interface Environment {
  browser: {
    /** Config id of the browser, e.g. "chrome-canary". */
    id: string;
    name: string;
    channel?: string;
    version: string;
    userAgent: string;
    headless: boolean;
    /** navigator.userAgentData full version list, when exposed. */
    fullVersionList?: { brand: string; version: string }[];
  };
  os: { platform: string; release: string; arch: string; version?: string };
  hardware: {
    cpuModel?: string;
    cores: number;
    memoryBytes?: number;
    /** navigator.deviceMemory (rounded, capped by the browser). */
    deviceMemoryGb?: number;
  };
  gpu?: GpuInfo;
  webgpu: boolean;
  crossOriginIsolated: boolean;
  backend: {
    kind: BackendKind;
    model?: string;
    /** Model version where exposed (e.g. Gemini Nano component version from the profile). */
    modelVersion?: string;
    dtype?: string;
    device?: string;
    /** Anything else the adapter reports, e.g. context window. */
    details?: Record<string, unknown>;
  };
  /** Browser command-line args, enabled features and relevant flags. */
  flags: string[];
  /** Built-in AI globals visible in the page. */
  builtInApis?: Record<string, boolean>;
}

/** What the page runtime can capture by itself. The runner fills in the rest. */
export interface PageEnvironment {
  userAgent: string;
  fullVersionList?: { brand: string; version: string }[];
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  cores: number;
  deviceMemoryGb?: number;
  webgpu: boolean;
  gpu?: GpuInfo;
  crossOriginIsolated: boolean;
  builtInApis: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface ModelInfo {
  model?: string;
  modelVersion?: string;
  dtype?: string;
  device?: string;
  details?: Record<string, unknown>;
}

export interface LoadReport {
  status: 'ok' | 'error' | 'unavailable' | 'timeout';
  availabilityBefore: AvailabilityReport;
  /** True when the model had to be fetched (availability was not "available"). */
  downloaded: boolean;
  /** Time spent while download progress was < 100%. */
  downloadMs?: number;
  /** Total time from load() call to a ready session / pipeline. */
  loadMs?: number;
  error?: string;
  model?: ModelInfo;
  /** Repeated cold starts measured in fresh pages, if configured. */
  coldStarts?: ColdStartSample[];
}

export interface ColdStartSample {
  loadMs: number;
  firstTtftMs?: number;
  firstTotalMs?: number;
}

export interface ProgressEvent {
  /** 0..1 */
  progress: number;
  loadedBytes?: number;
  totalBytes?: number;
  file?: string;
  text?: string;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface ExampleResult {
  exampleId: string;
  /** 'cold' for the first example after a model load, 'warm' otherwise. */
  phase: 'cold' | 'warm';
  repeat: number;
  status: TaskResponse['status'];
  output?: string;
  error?: string;
  attempts: number;
  timings: Timings;
  memory?: MemorySample;
  /** Scorer name → value. Scores are normalized to 0..1 unless a scorer says otherwise. */
  scores: Record<string, number>;
  /** Optional per-scorer detail (e.g. judge rationale). */
  scoreDetails?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface DatasetRef {
  id: string;
  path?: string;
  /** sha256 of the dataset file contents. */
  sha256: string;
  examples: number;
  license?: string;
}

export interface Distribution {
  n: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  min: number;
  max: number;
}

export interface CellSummary {
  total: number;
  ok: number;
  errors: number;
  timeouts: number;
  unavailable: number;
  /** Mean of each per-example score over examples with status ok (errors count as 0 when `strict`). */
  scores: Record<string, number>;
  /** Dataset-level metrics from scorer aggregates (e.g. macro F1). */
  aggregates: Record<string, number>;
  ttftMs?: Distribution;
  totalMs?: Distribution;
  tokensPerSecond?: Distribution;
  /** Same distributions restricted to warm examples. */
  warm?: { ttftMs?: Distribution; totalMs?: Distribution; tokensPerSecond?: Distribution };
}

export interface CellResult {
  /** `${dataset.id}/${backend.id}/${browser id}` */
  key: string;
  dataset: DatasetRef;
  task: TaskDefinition;
  backend: BackendSpec;
  environment: Environment;
  load: LoadReport;
  results: ExampleResult[];
  summary: CellSummary;
  /** Scorers used, in order; the first is the primary quality metric. */
  scorers: string[];
}

export interface RunFile {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  name?: string;
  startedAt: string;
  finishedAt: string;
  tool: { name: string; version: string };
  host: { platform: string; release: string; arch: string; cpuModel?: string; cores: number; memoryBytes: number };
  cells: CellResult[];
  notes?: string[];
}
