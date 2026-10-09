---
'web-ai-evals': patch
---

WebLLM backends accept `options.chatOpts`, passed to `CreateMLCEngine` to override the model's `mlc-chat-config.json`. Use `{ sliding_window_size: -1 }` to load Gemma 3 1B on WebLLM 0.2.85.
