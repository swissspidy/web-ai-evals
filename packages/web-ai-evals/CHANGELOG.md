# web-ai-evals

## 0.1.0

### Minor Changes

- [#8](https://github.com/swissspidy/web-ai-evals/pull/8) [`d9e9465`](https://github.com/swissspidy/web-ai-evals/commit/d9e9465fdac8e3346ab7f6b0502531e47afe7489) Thanks [@swissspidy](https://github.com/swissspidy)! - First release: run and compare LLM evals inside real browsers. Chrome and Edge built-in AI (Prompt API, Summarizer, Writer, Rewriter, Translator, Classifier), WebLLM and Transformers.js on WebGPU and Wasm, with quality and browser-only metrics side by side, HTML reports, run diffs, nightly drift checks and a promptfoo provider.

### Patch Changes

- [#13](https://github.com/swissspidy/web-ai-evals/pull/13) [`710fb44`](https://github.com/swissspidy/web-ai-evals/commit/710fb443d17213adc25848697470edf2457f87e5) Thanks [@swissspidy](https://github.com/swissspidy)! - WebLLM backends accept `options.chatOpts`, passed to `CreateMLCEngine` to override the model's `mlc-chat-config.json`. Use `{ sliding_window_size: -1 }` to load Gemma 3 1B on WebLLM 0.2.85.

- [#13](https://github.com/swissspidy/web-ai-evals/pull/13) [`710fb44`](https://github.com/swissspidy/web-ai-evals/commit/710fb443d17213adc25848697470edf2457f87e5) Thanks [@swissspidy](https://github.com/swissspidy)! - WebLLM: record each answer's `finishReason` in `extra`, and with `options.logprobs: 1-5` the first sampled tokens with their top alternatives.
