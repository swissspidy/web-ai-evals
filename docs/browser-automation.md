# Automating built-in AI with Playwright

What it takes to run Chrome's built-in AI (Prompt API, Summarizer, Translator,
…) from Playwright, and what the runner does for you. Verified with
Google Chrome 154.0.8037.57 on Linux (Ubuntu 24.04) and Playwright 1.63,
September 2026.

## Use branded Chrome, with a persistent profile

- Gemini Nano is delivered by Chrome's **component updater**. Playwright's
  bundled Chromium (and Chrome for Testing) doesn't have it, so launch Google
  Chrome with `channel: 'chrome' | 'chrome-beta' | 'chrome-dev' | 'chrome-canary'`.
  Edge uses `msedge*` channels.
- The model (about 4 GB) lives in the profile directory under
  `OptGuideOnDeviceModel/<version>/`. The runner keeps one persistent profile
  per browser id, by default in `~/.cache/web-ai-evals/profiles/<id>`, so the
  download happens once.
- In-page runtimes cache per origin (Cache API, IndexedDB, OPFS). The runner
  therefore serves the page runtime from a **fixed origin**,
  `http://127.0.0.1:47831`. Changing the port throws away the WebLLM and
  Transformers.js caches.

## Playwright's default switches break built-in AI

Playwright launches Chromium with switches that are sensible for web testing but
fatal here. `packages/web-ai-evals/src/runner/browsers.ts` removes them with
`ignoreDefaultArgs` and re-adds the harmless part:

| Default switch | Effect on built-in AI |
|---|---|
| `--disable-features=…,OptimizationHints,Translate,…` | Disables the on-device model service. `LanguageModel.create()` fails with *"Unable to create a text session because the service is not running"* and `chrome://on-device-internals` stays at *"Device performance class: Loading…"*. |
| `--disable-component-update` | The model component is never downloaded. |
| `--disable-background-networking` | The model manifest isn't fetched. |
| `--disable-field-trial-config` | Removed so the browser behaves like a user's install. |
| `--disable-extensions` | Blocks extension polyfills, such as WebAI Studio's `Classifier`. |

Chrome uses the last occurrence of a switch. The runner's own
`--disable-features=` and `--enable-features=` are appended after Playwright's
defaults, so they win.

## User activation

`LanguageModel.create()` (and `Summarizer.create()` and the others) needs
transient user activation while the model is `downloadable` or `downloading`.
The page runtime has a `#wae-activate` button. The runner arms a load, then
clicks the button with a trusted Playwright click, so downloads start without
a human.

## Model version

JavaScript can't read the built-in model version. The runner reads it from
the profile:

- `OptGuideOnDeviceModel/<component version>/manifest.json`: the
  `BaseModelSpec` field holds the base model name and version, for example
  `v3Nano` and `2025.08.14.1358`.
- `Local State` → `optimization_guide.on_device`: the performance class, VRAM
  and the requested asset, for example
  `nano_v3_cpu_component 2025.8.21.1028`.

All of this is recorded in `environment.backend` for every cell. Run diffs
flag changes to it.

## CPU-only machines

Chrome can run Gemini Nano on the CPU when the device has **at least 16 GB RAM
and at least 4 cores**. On a machine without a usable GPU, Chrome may still
pick the GPU asset. The model process then crashes, and after a few crashes
Chrome blocks the version: *"The model process crashed too many times for this
version"*.

Enable the `force-cpu` preset (`--enable-features=OnDeviceModelForceCpuBackend`)
on such machines. Chrome then downloads the CPU asset (`nano_v3_cpu_component`)
and runs on the CPU. The crash counter is stored in `Local State` at
`optimization_guide.on_device.model_crash_count`. Reset it with the button in
`chrome://on-device-internals` → Broker State, or delete the profile.

Measured on a 4-core Xeon VM with 16 GB RAM and no GPU (Chrome 154, CPU
backend):

- Loading from the profile takes about 1.5 to 3 s.
- The first download took about 2 minutes.
- Sentiment classification takes about 1.4 s TTFT per example.

## Gemma 4 as the built-in model

Chrome 154 has a flag, `chrome://flags/#gemma4-for-built-in-ai` ("Gemma 4 for
Built-in AI"), that switches every built-in API (Prompt, Summarizer, Writer, …)
from Gemini Nano to Gemma 4. Behind the flag are two features:
`AIApiFoundationalModel:model_version/v4` and `OptimizationGuideManifestBroker`.
The `gemma4` preset turns both on.

Use it with a separate browser id, for example `chrome-gemma4` as in
`showcase.config.ts`. Each browser id gets its own profile, so Gemini Nano and
Gemma 4 can be compared in one run.

What we saw on Chrome 154 (Linux, 4-core VM, no GPU):

- **Download works.** The model is `gemma4-2b-it`, base version
  2026.06.10.0000, component 2026.8.7.929, about 2.4 GB. The manifest broker
  stores it under `OptGuideManifestModel/<asset hash>/<version>/`, not
  `OptGuideOnDeviceModel/`. The runner reads both layouts, so Gemma 4 cells
  record the right model and version.
- **Chrome is willing to run it.** `chrome://on-device-internals` shows
  `prompt_api_gemma4` as Available and a `gemma4_cpu_model` on the CPU backend.
- **It doesn't run without a GPU.** Every `create()` fails with "The device is
  unable to create a session to run the model". The model service aborts while
  it initializes: SIGILL on a deliberate `ud1` trap, just after
  `litert::ml_drift::CreateDelegate` in `libLiteRtWebGpuAccelerator.so`. So
  LiteRT always sets up its WebGPU accelerator, even for the CPU model, and
  aborts when there is no GPU adapter. A software adapter (the `unsafe-webgpu`
  preset, SwiftShader) aborts the same way.
- **`availability()` misleads here too.** It returns `available` for every
  task, so the failure only shows up when `create()` is called.
- **Chrome stops retrying.** After three crashes Chrome refuses to load the
  version. `web-ai-evals doctor` prints the crash count and flags this.

On a GPU it works. Measured on an Apple M4 Pro (macOS, Metal, 48 GB) with
Chrome 155 and 156, same model and component versions as above:

- `create()` succeeds and loads from the profile in about 1.4 s. Chrome reports
  performance class 5 and 0 crashes.
- On the full suites (710 examples, Chrome 156.0.8078.12), Gemma 4 is worse
  than Gemini Nano at sentiment: accuracy 0.867 vs 0.940, 95% CI of the
  difference −0.107 to −0.040. The gap is in the hard examples (0.743 vs 0.879
  on 140 items with sarcasm, negation or understatement; 0.975 vs 0.994 on the
  rest). Gemma 4 answers in the right format; it misreads the sarcasm.
- Summaries, extraction and translation are level: ROUGE-L 0.318 vs 0.319,
  field accuracy 0.977 vs 0.970, chrF 0.804 vs 0.823 (every interval includes
  zero).
- Gemini Nano reaches the first token sooner (136 ms vs 866 ms on sentiment).
  Gemma 4 streams faster once it starts (106 vs 55 tokens/s on summaries).

The numbers are in the [first report](https://swissspidy.github.io/web-ai-evals/2026-09-29-cpu/).

## Headless

Checked with Chrome 154 on Linux. Once the model is in the profile, the Prompt
API and Summarizer work in Chrome's new headless mode (`headless: true`, no X
server). Timings matched headful: sentiment TTFT p50 was 1.28 s headless and
1.30 s headful on the same machine.

The first download was done headful (under Xvfb) and is not re-verified in
headless mode. Headful stays the default because that's how users run the
APIs. Headless results are recorded with `browser.headless: true`, so they
stay separate in reports and diffs.

## Known API issues seen during runs (Chrome 154 Stable, Linux, CPU backend)

- **Summarizer ignores `format: "plain-text"`.**
  - With `type: "tldr"` it returned Markdown news articles (12 of 12), 2–3×
    longer than the input, with invented placeholders ("[Region Name]").
  - With `type: "key-points"`, 7 of 12 outputs were lists of questions about
    the article.
  - `key-points` with the default Markdown format behaved correctly.
- **Translator fails on first use, with misleading errors.** In a profile
  that has never translated, `Translator.create()` starts installing the
  TranslateKit runtime and the language pack, then fails immediately instead
  of waiting for them.
  - The error is either "Unable to create translator for the given source
    and target language" or "The translation service count exceeded the
    limitation".
  - The second message is misleading. In Chromium it means either that more
    than 10 origins are using the translation service
    (`TranslationAPIMaxServiceCount`), or that the translation installer
    isn't ready yet. Here it was the second.
  - This is not a cloud rate limit: the Translator runs on-device, so cooling
    down or clearing the cache doesn't apply.
  - Once both components are installed, `create()` succeeds. The runner
    retries a Translator load every 15 s, with a fresh user activation, while
    it sees these errors. Verified on a fresh profile: one failed attempt, then
    success.
  - `availability()` keeps returning `downloadable` even after both
    components are installed and translation works.

## WebLLM: Gemma 3 1B on 0.2.85

WebLLM 0.2.85 can't load its own prebuilt `gemma3-1b-it-q4f16_1-MLC`. The
model record sets `context_window_size: 4096`, the model's
`mlc-chat-config.json` sets `sliding_window_size: 512`, and WebLLM refuses a
config where both are positive (`WindowSizeConfigurationError`, seen on an
Apple M4 Pro with Chrome 156). Keeping the sliding window instead fails too,
because the model has no attention sink. The showcase config passes
`options: { chatOpts: { sliding_window_size: -1 } }`; the WebLLM adapter hands
`chatOpts` to `CreateMLCEngine`, which applies it after the model record.
Prompts in these suites are well under 1,000 tokens, so the window setting
doesn't change results.

## Networks with TLS-intercepting proxies

The runner passes `$HTTPS_PROXY` to the browser; set `proxy: false` to disable
that. Chrome on Linux trusts only its NSS store (`~/.pki/nssdb`), not the
system CA bundle, so a proxy CA has to be added there with
`certutil -A -d sql:$HOME/.pki/nssdb -n <name> -t C,, -i ca.crt`. The
component updater only works through proxies that allow HTTPS `CONNECT`.

## Debugging

- `web-ai-evals doctor --config <file>` prints the WebGPU adapter, the built-in
  AI globals and each backend's availability for every browser in a config.
- `chrome://on-device-internals` shows the device performance class, the
  manifest criteria (VRAM, disk, RAM), asset download progress and the reason
  a use case is unavailable. On Chrome 154 it has to be enabled first from
  `chrome://chrome-urls`.
- `DEBUG=pw:browser` shows Chrome's stderr. Add
  `--enable-logging=stderr --v=1` to the browser `args` for more detail.
