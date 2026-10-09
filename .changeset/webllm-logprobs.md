---
'web-ai-evals': patch
---

WebLLM: record each answer's `finishReason` in `extra`, and with `options.logprobs: 1-5` the first sampled tokens with their top alternatives.
