import type {
  AvailabilityReport,
  BackendKind,
  BackendSpec,
  ModelInfo,
  ProgressEvent,
  TaskDefinition,
  TaskRequest,
  TaskType,
  TokenCountSource,
} from '../../core/index.js';

export interface LoadContext {
  signal: AbortSignal;
  onProgress(event: ProgressEvent): void;
}

export interface RunContext {
  signal: AbortSignal;
  /** Report a streamed delta (only the new text). */
  onChunk(delta: string): void;
}

export interface BackendRunResult {
  output: string;
  outputTokens?: number;
  inputTokens?: number;
  tokenCountSource?: TokenCountSource;
  extra?: Record<string, unknown>;
}

export interface LoadedBackend {
  info: ModelInfo;
  run(request: TaskRequest, ctx: RunContext): Promise<BackendRunResult>;
  /** Count tokens of a text with the backend's tokenizer, outside the timed region. */
  countTokens?(text: string): Promise<number | undefined>;
  dispose(): Promise<void>;
}

export interface BackendAdapter {
  kind: BackendKind;
  /** Task types this adapter can serve. */
  tasks: TaskType[];
  /** Never throws: unsupported environments return `unavailable` with a reason. */
  availability(spec: BackendSpec, task: TaskDefinition): Promise<AvailabilityReport>;
  load(spec: BackendSpec, task: TaskDefinition, ctx: LoadContext): Promise<LoadedBackend>;
}

/** Iterate a ReadableStream<string> of deltas. */
export async function pipeStream(stream: ReadableStream<string>, ctx: RunContext): Promise<string> {
  const reader = stream.getReader();
  let text = '';
  const onAbort = () => reader.cancel().catch(() => {});
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        text += value;
        ctx.onChunk(value);
      }
    }
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
  }
  return text;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Loose access to experimental globals whose typings drift between Chrome versions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const g = globalThis as any;
