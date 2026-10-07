# web-ai-evals

**Run and compare LLM evals inside real browsers.**

Web AI runs in the browser: built-in AI in Chrome and Edge (Prompt API,
Summarizer, Writer, Rewriter, Translator, Classifier), WebLLM, and
Transformers.js on WebGPU and Wasm. Quality and speed depend on the browser,
the backend, quantization and the hardware, and built-in models change
silently with browser updates.

web-ai-evals launches Chrome or Edge with Playwright, runs your JSONL dataset
through each backend inside a page, and measures quality next to
browser-only metrics: time to first token, tokens per second, cold start,
model downloads. Each run records the full environment (browser version,
built-in model version, GPU, flags), so results stay comparable and drift is
visible.

## Install

Requires Node 24+ (for TypeScript config files) and Google Chrome or
Microsoft Edge.

```sh
npm install --save-dev web-ai-evals
```

## Use

```ts
// evals.config.ts
import { defineConfig } from 'web-ai-evals';
import { classification } from 'web-ai-evals/scorers';

export default defineConfig({
  name: 'sentiment',
  browsers: ['chrome'],
  backends: [
    { id: 'gemini-nano', kind: 'prompt-api' },
    { id: 'qwen-wasm', kind: 'transformers', model: 'onnx-community/Qwen2.5-0.5B-Instruct', device: 'wasm', dtype: 'q4' },
  ],
  suites: [
    {
      id: 'sentiment',
      dataset: './sentiment.jsonl', // {"id", "input", "expected"} per line
      task: { type: 'classify', labels: ['positive', 'negative', 'neutral'] },
      scorers: [classification()],
    },
  ],
});
```

```sh
npx web-ai-evals doctor --config evals.config.ts   # what can this machine run?
npx web-ai-evals run --config evals.config.ts      # writes results/<runId>.json and .html
```

The CLI also has `report` (merge runs from several machines), `diff` (flag
model, score and latency changes between runs or browser channels), `nightly`,
`rescore` and `serve`.

## Entry points

| Import | Contents |
|---|---|
| `web-ai-evals` | `defineConfig`, `runEvals`, `BrowserSession` (run requests in a browser from your own code), types |
| `web-ai-evals/scorers` | `exactMatch`, `contains`, `regex`, `rougeL`, `chrF`, `jsonValid`, `jsonSchema`, `jsonFieldMatch`, `classification`, `embeddingSimilarity`, `llmJudge`, `custom` |
| `web-ai-evals/report` | HTML reports, run diffs, Markdown summaries |
| `web-ai-evals/promptfoo` | A [promptfoo](https://www.promptfoo.dev) provider: `id: file://node_modules/web-ai-evals/dist/promptfoo/provider.js` |

`embeddingSimilarity` uses `@huggingface/transformers` in Node by default;
install it if you use that scorer, or pass your own `embed` function.

## Documentation

Backends, browser presets, metrics, example datasets and reports:
[github.com/swissspidy/web-ai-evals](https://github.com/swissspidy/web-ai-evals#readme).

## License

Apache-2.0. Models are downloaded from their publishers at run time and keep
their own terms.
