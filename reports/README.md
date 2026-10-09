# Reports

Published at **https://swissspidy.github.io/web-ai-evals/**. The `Pages`
workflow deploys this directory (minus the build script and this README) on
every push to `main` that touches it.

| Report | Machine | Backends |
|---|---|---|
| [2026-09-29-cpu](2026-09-29-cpu/index.html) ([full generated report](2026-09-29-cpu/full-report.html), run files: [CPU](2026-09-29-cpu/run.json), M4 Pro [built-in](2026-09-29-cpu/run-m4pro-full.json), [Transformers.js](2026-09-29-cpu/run-m4pro-gemma3.json), [WebLLM](2026-09-29-cpu/run-m4pro-webllm.json)) | Linux VM, 4-core Xeon, 16 GB, **no GPU**, Chrome 154 | Gemini Nano (CPU), Summarizer API, Translator API, Qwen2.5-0.5B on Transformers.js Wasm |
| | Apple M4 Pro, 48 GB, Metal GPU, Chrome 156 (2026-10-08), full suites | Gemini Nano (GPU), Gemma 4 2B (`gemma4` preset); Gemma 3 1B on Transformers.js WebGPU and WebLLM (2026-10-09) |

`index.html` and `full-report.html` are built from the run files:

```sh
node reports/build-showcase.mjs reports/2026-09-29-cpu/run.json reports/2026-09-29-cpu/run-m4pro-full.json reports/2026-09-29-cpu/run-m4pro-gemma3.json reports/2026-09-29-cpu/run-m4pro-webllm.json > reports/2026-09-29-cpu/index.html
pnpm wae report reports/2026-09-29-cpu/run.json reports/2026-09-29-cpu/run-m4pro-full.json reports/2026-09-29-cpu/run-m4pro-gemma3.json reports/2026-09-29-cpu/run-m4pro-webllm.json --out reports/2026-09-29-cpu/full-report.html
```

`results/` is gitignored, so copy a run file next to the report before
building from it. With more than one run file, every row is labelled with its
machine.

It writes a standalone HTML document. Pass `--fragment` for hosts that add their
own document wrapper. When you add a report, also link it from `index.html`.

## Adding the GPU backends

The comparison plan also covers Phi-4-mini (Edge's Prompt API). Gemma 3 1B
through WebLLM and through Transformers.js on WebGPU was measured on the M4 Pro
(2026-10-09); Phi-4-mini still needs Edge Dev or Canary on a GPU machine.

1. **Run the showcase on a GPU machine:**
   ```sh
   pnpm install && pnpm build
   pnpm wae doctor --config showcase.config.ts   # confirm availability
   pnpm wae run --config showcase.config.ts
   ```
   The machine should be a Mac with Apple silicon, or a Windows PC with a
   discrete GPU. For Phi-4-mini, use Windows or macOS with Edge Dev or
   Canary, and enable "Prompt API for on-device language model" in
   `edge://flags`.
2. **Merge that run with the CPU run into one report:**
   ```sh
   pnpm wae report reports/2026-09-29-cpu/run.json results/<gpu-run>.json --out report.html
   node reports/build-showcase.mjs reports/2026-09-29-cpu/run.json results/<gpu-run>.json > index.html
   ```
   Cells that exist on both machines get the host appended to their label.
