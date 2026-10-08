# web-ai-evals

**Run and compare LLM evals inside real browsers.**

Web AI runs in the browser:

- built-in AI in Chrome and Edge (Prompt API, Summarizer, Writer, Rewriter,
  Translator, Classifier)
- WebLLM
- Transformers.js on WebGPU and Wasm

Quality and speed depend on the browser, the backend, quantization and the
hardware. Built-in models also change silently with browser updates.

Existing eval tools don't run models in a browser. web-ai-evals is the
browser execution environment for evals:
- It runs the same dataset across backends and browsers on real hardware.
- It measures quality and browser-only metrics side by side.
- It records the full environment, so results are comparable and drift is
  visible.

```
suite (JSONL) × backends × browsers  ──►  results/<runId>.json  ──►  HTML report / diff
```

## Status

| Backend | Adapter | Verified end to end |
|---|---|---|
| Prompt API (Gemini Nano, Chrome) | `prompt-api` | ✅ Chrome 154 Stable, Linux, CPU backend; Chrome 155, macOS, Apple M4 Pro GPU |
| Prompt API (Phi-4-mini, Edge) | `prompt-api` | ⚠️ needs Edge Dev/Canary on Windows/macOS with a GPU |
| Prompt API (Gemma 4 2B, Chrome flag) | `prompt-api` + `gemma4` preset | ✅ Chrome 155, macOS, Apple M4 Pro GPU; crashes without a GPU ([details](docs/browser-automation.md#gemma-4-as-the-built-in-model)) |
| Summarizer / Writer / Rewriter | `summarizer`, `writer`, `rewriter` | ✅ Summarizer on Chrome 154 (see the known issue with `plain-text`); Writer and Rewriter need the `writing-apis` flag preset |
| Translator | `translator` | ✅ Chrome 154 (fails on first use until Chrome installs the translation runtime; the runner retries — [details](docs/browser-automation.md#known-api-issues-seen-during-runs-chrome-154-stable-linux-cpu-backend)) |
| Classifier (WebAI Studio extension polyfill) | `classifier` | ⚠️ needs the extension installed in the profile |
| WebLLM | `webllm` | ⚠️ needs a WebGPU adapter; SwiftShader loses the device |
| Transformers.js WebGPU | `transformers` + `device: webgpu` | ⚠️ needs a WebGPU adapter with `shader-f16` for q4f16 |
| Transformers.js Wasm | `transformers` + `device: wasm` | ✅ Chrome 154 (Qwen2.5-0.5B q4) |
| Mock (deterministic, for tests) | `mock` | ✅ CI |

"✅" means a full run on the browser and machine named in the row: the
repository's development environment, a 4-core Linux VM with 16 GB RAM and
**no GPU**, or an Apple M4 Pro (Metal GPU) for the GPU results. GPU backends are implemented against
the current APIs and report "unavailable" with a reason when the device can't
run them. See [the first report](#first-report) and
[docs/browser-automation.md](docs/browser-automation.md).

## Quick start

Requires Node 24+ (for native TypeScript configs) and Google Chrome.

### In your own project

```sh
npm install --save-dev web-ai-evals
npx web-ai-evals doctor --config evals.config.ts
npx web-ai-evals run --config evals.config.ts
```

Write `evals.config.ts` as shown under [Configuration](#configuration). The
JSONL datasets in [`suites/`](suites) are a good starting point; they aren't
part of the npm package, so copy the ones you want.

### From this repository

Includes the example suites and the showcase config. Needs pnpm.

```sh
pnpm install
pnpm build

# What can this machine run?
pnpm wae doctor --config showcase.config.ts

# Milestone 1: sentiment on Gemini Nano (Prompt API) in Chrome
pnpm wae run --config evals.config.ts

# Everything: built-in AI vs WebLLM vs Transformers.js on four suites
pnpm wae run --config showcase.config.ts
```

Each run writes `results/<runId>.json` and `results/<runId>.html`.

The first run downloads the models into persistent profiles under
`~/.cache/web-ai-evals/profiles/`; later runs reuse them. On a machine without
a supported GPU, set `WAE_FORCE_CPU=1` to run Gemini Nano on Chrome's CPU
backend. That needs 16 GB RAM and 4 cores.

## Configuration

```ts
// evals.config.ts
import { defineConfig } from 'web-ai-evals';
import { classification } from 'web-ai-evals/scorers';

export default defineConfig({
  name: 'sentiment',
  browsers: ['chrome', 'chrome-canary', { id: 'edge', channel: 'msedge-dev' }],
  backends: [
    { id: 'gemini-nano', kind: 'prompt-api', browsers: ['chrome', 'chrome-canary'] },
    { id: 'phi-4-mini', kind: 'prompt-api', browsers: ['edge'] },
    { id: 'gemma-webllm', kind: 'webllm', model: 'gemma3-1b-it-q4f16_1-MLC' },
    { id: 'gemma-tjs', kind: 'transformers', model: 'onnx-community/gemma-3-1b-it-ONNX-GQA', device: 'webgpu', dtype: 'q4f16' },
  ],
  suites: [
    {
      id: 'sentiment',
      dataset: './suites/sentiment/data.jsonl',
      task: { type: 'classify', labels: ['positive', 'negative', 'neutral'] },
      scorers: [classification()],
    },
  ],
  run: { timeoutMs: 120_000, retries: 1, repeats: 1, coldStarts: 0 },
});
```

**Datasets** are JSONL files. Each line is
`{"id", "input", "expected"?, "meta"?}`. `input` is either a string or an object
`{ text, context?, sourceLanguage?, targetLanguage?, labels?, schema? }`.

**The task** decides how a backend is called:
- *Chat models* (Prompt API, WebLLM, Transformers.js) get a prompt rendered
  from the task's template.
- *Task APIs* (Summarizer, Translator, …) get the text directly.

So one dataset can drive both kinds of backend. Task types: `generate`,
`summarize`, `write`, `rewrite`, `translate`, `classify` and `extract`.

**Scorers** come from `web-ai-evals/scorers`:

| Scorer | What it measures |
|---|---|
| `exactMatch` | Exact match |
| `contains` | Output contains the expected text |
| `regex` | Output matches a pattern |
| `rougeL` | Summarization overlap |
| `chrF` | Translation overlap |
| `jsonValid` | Output is valid JSON |
| `jsonSchema` | Output matches a JSON schema |
| `jsonFieldMatch` | Share of expected fields that match |
| `classification` | Accuracy, macro-F1 and invalid-label rate |
| `embeddingSimilarity` | Similarity via a Transformers.js embedder in Node |
| `llmJudge` | LLM-as-judge (Anthropic or an OpenAI-compatible API); the key is read from the environment |
| `custom(name, fn)` | Your own scoring function |

Scoring runs in Node, so API keys never reach the page. To apply new scorers to
an existing run without launching a browser, run `web-ai-evals rescore`.

**Browser presets** turn on Chrome flags:

| Preset | Effect |
|---|---|
| `force-cpu` | Runs Gemini Nano on the CPU backend |
| `gemma4` | Runs every built-in API on Gemma 4 instead of Gemini Nano (`chrome://flags/#gemma4-for-built-in-ai`); give it its own browser id so it gets its own profile |
| `writing-apis` | Enables Writer, Rewriter and Proofreader |
| `sampling-mode` | Enables `samplingMode` on the Prompt API |
| `unsafe-webgpu` | Enables WebGPU on Linux and software adapters |

## Metrics

Recorded for each example:

- output
- per-scorer score
- **time to first token**: the first streamed non-empty chunk
- **total latency**
- **tokens/second**: decode rate after the first token; `tokenCountSource`
  says whether the count was reported by the backend, re-tokenized, or taken
  from chunk counts
- status (`ok`, `error`, `timeout` or `unavailable`) and attempts
- JS heap

Recorded for each cell (suite × backend × browser):

- availability before loading and whether a download happened
- **cold start** (load time); `run.coldStarts` adds repeated cold starts, each
  in a fresh page
- the first example is tagged `cold`, later ones `warm`
- the **environment**:
  - browser name, channel and version (full version list), headless or not
  - OS, CPU, cores, RAM
  - WebGPU adapter info and features
  - backend, model id, dtype and device
  - built-in model version read from the profile (e.g. `v3Nano 2025.08.14.1358`)
  - flags

Summaries count failed examples as 0, so a backend can't look better by
failing the hard ones.

The full schema is in [ADR 0001](docs/adr/0001-architecture.md) and
[packages/web-ai-evals/src/core/types.ts](packages/web-ai-evals/src/core/types.ts).

## CLI

```
web-ai-evals run      --config <file> [--browsers a,b] [--backends a,b] [--suites a,b] [--limit N]
web-ai-evals doctor   --config <file>                     # environment + availability per backend
web-ai-evals report   <run.json...> [--out r.html]        # merge runs from several machines into one report
web-ai-evals diff     <before.json> [after.json] [--browsers chrome:chrome-canary] [--fail-on-flags]
web-ai-evals nightly  --config nightly.config.ts --history <dir> [--fail-on-flags]
web-ai-evals rescore  --config <file> <run.json>
web-ai-evals serve                                         # serve the page runtime for manual debugging
```

`diff` flags changes to the built-in model version, scores that move by at
least 0.05, and latency or throughput that changes by ×1.5 or more. It works
between two runs (drift) or between two browsers in one run
(Stable vs Canary).

## Integrations

- **Promptfoo:** `web-ai-evals/promptfoo` is a custom provider
  ([example and docs](examples/promptfoo)). Each promptfoo prompt goes through a backend in a real browser and
  comes back with `latencyMs`, token usage and `metadata.ttftMs` /
  `tokensPerSecond`.
- **Harbor:** assessed in [docs/harbor.md](docs/harbor.md). A browser
  *environment* is possible but a poor fit. The better route is a model bridge,
  which is documented as a follow-up.
- **Programmatic / Belay:** `BrowserSession` opens a browser, loads a backend
  and runs requests. [`examples/calibrate.ts`](examples/calibrate.ts) shows a
  calibration step: pick the best backend on this device from a small
  labeled set.

## Verification log

Everything below was run in a CPU-only Linux VM (4 cores, 16 GB) with Google
Chrome installed.

- **Milestone 1:** sentiment on the Prompt API in Playwright-launched Chrome 154
  with a persistent profile.
  - First run: Gemini Nano downloaded in 119 s; 40/40 examples OK; TTFT p50
    1.44 s.
  - Second run: availability `available`, no download, model loaded in 1.5 s.
- **Milestone 2:** Gemini Nano, Chrome's Summarizer and Translator APIs, and
  Transformers.js (Qwen2.5-0.5B on Wasm), all on the same four suites.
  - WebLLM and Transformers.js WebGPU are implemented and report *unavailable*
    (no WebGPU adapter). WebLLM on a SwiftShader adapter loses the device.
  - Report: [swissspidy.github.io/web-ai-evals](https://swissspidy.github.io/web-ai-evals/2026-09-29-cpu/)
    (source: [`reports/2026-09-29-cpu`](reports/2026-09-29-cpu)).
- **Milestone 3:** `web-ai-evals nightly` on Chrome Stable 154 and Beta 155,
  run on two consecutive "nights".
  - Both channels ship v3Nano 2025.08.14.1358, and neither night flagged
    anything.
  - Run-to-run noise on identical setups: up to 0.036 ROUGE-L (6 summaries)
    and 0.025 field accuracy (10 extractions).
  - A simulated model-version change flags every affected cell and exits 2.
  - Canary 156 couldn't install Nano here: Chrome requires 20 GB free, and
    `doctor` shows that reason. Example output:
    [`reports/nightly-example`](reports/nightly-example).
- **Milestone 4:** promptfoo 0.123 → provider → Chrome → Gemini Nano,
  [`nano-smoke.yaml`](examples/promptfoo/nano-smoke.yaml)
  passes 3/3. The Harbor assessment is in [docs/harbor.md](docs/harbor.md).

## CI

- `.github/workflows/ci.yml` runs on GitHub-hosted runners. It covers
  typecheck, publint, unit tests, and an end-to-end run with the mock backend in
  headless Chromium plus the Promptfoo provider.
- `.github/workflows/nightly.yml` runs on a **self-hosted GPU machine** (a Mac
  mini is ideal). It runs a small suite on Chrome Stable, Beta and Canary and
  fails when the built-in model or its quality changes. Setup is in
  [docs/self-hosted-runner.md](docs/self-hosted-runner.md).
- `.github/workflows/release.yml` keeps a "Version packages" pull request open
  while changesets are pending and publishes to npm when it is merged.

## Package

Everything ships as one npm package, [`web-ai-evals`](packages/web-ai-evals):

| Import | Contents |
|---|---|
| `web-ai-evals` | `defineConfig`, `runEvals`, `BrowserSession`, types, JSONL datasets, prompt templates, stats |
| `web-ai-evals/scorers` | Scorers |
| `web-ai-evals/report` | HTML report, run diffs, Markdown summaries |
| `web-ai-evals/promptfoo` | Promptfoo provider |

The source is split the same way under
[`packages/web-ai-evals/src/`](packages/web-ai-evals/src), plus `runner/` (the
Node orchestrator and CLI) and `page-runtime/` (the in-page backend adapters,
bundled into `dist/www/`).

Releases use [Changesets](.changeset/README.md): run `pnpm changeset` in a pull
request that changes the package.

## First report

**[Read it on GitHub Pages](https://swissspidy.github.io/web-ai-evals/2026-09-29-cpu/)**
(source: [`reports/2026-09-29-cpu/`](reports/2026-09-29-cpu)). It compares Gemini Nano,
Chrome's Summarizer and Translator APIs, and Qwen2.5-0.5B on Transformers.js
Wasm across all four suites, in Chrome 154 on a CPU-only machine. A second run
on an Apple M4 Pro adds Gemini Nano on the GPU and Gemma 4 (Chrome 155).

Headline results:
- Gemini Nano matches or beats the 0.5B in-page model on every suite
  (sentiment 0.900 vs 0.767, translation chrF 0.860 vs 0.496).
- Gemini Nano is 2–9× faster on CPU.
- Chrome's Translator API matches Gemini Nano on translation (chrF 0.854 vs
  0.860) at 20 ms per sentence instead of 1.8 s.
- Chrome's Summarizer API misbehaves with `format: "plain-text"`.
- On the M4 Pro, Gemma 4 scores within 0.04 of Gemini Nano on every suite.
  Nano reaches the first token sooner (135 ms vs 877 ms on sentiment); Gemma 4
  streams faster (106 vs 56 tokens/s on summaries).
- Gemini Nano is 4–9× faster per example on the M4 Pro's GPU than on the
  CPU-only machine.

Phi-4-mini and Gemma 3 via WebLLM and Transformers.js WebGPU are still to be
measured; see [reports/README.md](reports/README.md) for how to add them.

**Headless:** the Prompt API and Summarizer work in Chrome's new headless mode
once the model is in the profile, with timings matching headful.

## Licenses

- Code: Apache-2.0.
- Datasets in `suites/`: written for this project, CC0-1.0.
- Models are downloaded from their publishers at run time and never
  redistributed. Their own terms apply:
  - Gemini Nano: Google's Generative AI Prohibited Use Policy and the Chrome
    terms
  - Phi-4-mini: MIT
  - Gemma: the Gemma Terms of Use
  - Qwen2.5: Apache-2.0
