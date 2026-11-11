# web-ai-evals

## 0.1.0

### Minor Changes

- [#8](https://github.com/swissspidy/web-ai-evals/pull/8) [`d9e9465`](https://github.com/swissspidy/web-ai-evals/commit/d9e9465fdac8e3346ab7f6b0502531e47afe7489) Thanks [@swissspidy](https://github.com/swissspidy)! - First release: run and compare LLM evals inside real browsers. Chrome and Edge built-in AI (Prompt API, Summarizer, Writer, Rewriter, Translator, Classifier), WebLLM and Transformers.js on WebGPU and Wasm, with quality and browser-only metrics side by side, HTML reports, run diffs, nightly drift checks and a promptfoo provider.

### Patch Changes

- [#23](https://github.com/swissspidy/web-ai-evals/pull/23) [`85a2e73`](https://github.com/swissspidy/web-ai-evals/commit/85a2e73a2ab6d0bd9d5824cb63def23753a0cf7e) Thanks [@swissspidy](https://github.com/swissspidy)! - Fixes from a full review:
  
  - An example that hits its timeout is recorded as `timeout` even when the backend answers the abort by returning partial output (Transformers.js, WebLLM, cancelled built-in AI streams). It used to be scored as `ok`.
  - `rescore` scores every example of a run made with a larger `--limit` than the config's, and reads each dataset once instead of once per cell.
  - CLI: `report`, `rescore` and `run --resume` no longer overwrite a run file whose name doesn't end in `.json` with the HTML report; `--limit`, `--port`, `--score-threshold` and `--latency-ratio` reject values that aren't numbers.
  - `classification()` counts labels that differ only in case as one class in macro-F1; `regex()` works with global patterns; Transformers.js backends honour `generation.topP`.
  - Diffs count changed outputs against the examples compared rather than all repeats, and the nightly channel comparison is always headed with both browser ids.
  - `DEFAULT_PORT` and `defaultProfilesDir()` are exported.
  - The promptfoo provider relaunches a browser that died between calls, and retries a failed launch on the next call, instead of failing every later test.
  - Markdown diffs list a cell whose outputs changed even when no score moved.
  - `llmJudge()` defaults to `claude-sonnet-5-5` for the Anthropic provider, at low effort and with room for the model's thinking in `maxTokens` (default 4096); `effort` is a new option.
  - Removed what nothing used or produced: `bootstrapCI`, the `'estimate'` token count source, `memory.uaSpecificBytes`, and the page runtime's `abort()` and `measureMemory()`.

- [#13](https://github.com/swissspidy/web-ai-evals/pull/13) [`710fb44`](https://github.com/swissspidy/web-ai-evals/commit/710fb443d17213adc25848697470edf2457f87e5) Thanks [@swissspidy](https://github.com/swissspidy)! - WebLLM backends accept `options.chatOpts`, passed to `CreateMLCEngine` to override the model's `mlc-chat-config.json`. Use `{ sliding_window_size: -1 }` to load Gemma 3 1B on WebLLM 0.2.85.

- [#13](https://github.com/swissspidy/web-ai-evals/pull/13) [`710fb44`](https://github.com/swissspidy/web-ai-evals/commit/710fb443d17213adc25848697470edf2457f87e5) Thanks [@swissspidy](https://github.com/swissspidy)! - WebLLM: record each answer's `finishReason` in `extra`, and with `options.logprobs: 1-5` the first sampled tokens with their top alternatives.
