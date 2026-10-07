# Promptfoo provider

A [promptfoo](https://www.promptfoo.dev) custom provider. It sends each prompt
through a model running **inside a real browser tab**: Chrome or Edge built-in
AI, WebLLM, or Transformers.js on WebGPU or Wasm.

Promptfoo's own Transformers.js provider runs in Node, and its browser
provider automates web UIs. This provider runs the actual in-browser backends.

```sh
npm install --save-dev promptfoo web-ai-evals
```

```yaml
providers:
  - id: file://node_modules/web-ai-evals/dist/promptfoo/provider.js
    label: gemini-nano
    config:
      browser: chrome                     # or { channel, headless, presets: [force-cpu], ... }
      backend: { kind: prompt-api }
  - id: file://node_modules/web-ai-evals/dist/promptfoo/provider.js
    label: gemma-webllm
    config:
      browser: chrome
      backend: { kind: webllm, model: gemma3-1b-it-q4f16_1-MLC, generation: { maxTokens: 128 } }
```

## Config

| Option | Meaning |
|---|---|
| `browser` | A channel (`chrome`, `chrome-canary`, `msedge-dev`, `chromium`, …) or a full browser config (see the [main README](../../README.md#configuration)) |
| `backend` | A backend spec: `{ kind, model?, device?, dtype?, options?, generation? }` |
| `task` | Wraps the prompt. The default is `{ type: 'generate', prompt: '{{text}}' }`. |
| `timeoutMs`, `loadTimeoutMs`, `retries` | Per-call timeout, model load timeout, retries |
| `idleCloseMs` | Closes the browser after this many ms without calls (default 3000), so promptfoo can exit |

## Behaviour

- **One browser per browser id.** Calls are serialized, so there is one GPU
  job at a time and latency isn't distorted by promptfoo's concurrency.
- **Response fields:** `latencyMs` is the in-page wall time, so the `latency`
  assertion measures the model, not the RPC. `tokenUsage.completion` is filled
  in where the backend knows it.
- **Metadata:** `metadata` carries `ttftMs`, `tokensPerSecond`,
  `tokenCountSource` and `loadMs`, the last on the call that loaded the model.

## Try it

```sh
pnpm install && pnpm build
cd examples/promptfoo
pnpm exec promptfoo eval -c promptfooconfig.yaml   # mock backend, runs anywhere
pnpm exec promptfoo eval -c gemini-nano.yaml       # Gemini Nano vs Transformers.js (needs Chrome)
```
