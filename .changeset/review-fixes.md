---
'web-ai-evals': patch
---

Fixes from a full review:

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
