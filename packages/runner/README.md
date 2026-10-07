# @web-ai-evals/runner

**Run and compare LLM evals inside real browsers.** The CLI and Node
orchestrator of [web-ai-evals](https://github.com/swissspidy/web-ai-evals): it launches Chrome or Edge with
Playwright, loads a backend in a page (Chrome and Edge built-in AI, WebLLM or
Transformers.js), runs your JSONL dataset through it, and writes a run file
and an HTML report.

```sh
npm install --save-dev @web-ai-evals/runner @web-ai-evals/scorers
npx web-ai-evals doctor --config evals.config.ts   # what can this machine run?
npx web-ai-evals run --config evals.config.ts
```

Requires Node 24+ (for TypeScript config files) and an installed Chrome or
Edge. The CLI also has `report`, `diff`, `nightly`, `rescore` and `serve`.
`BrowserSession` is the programmatic API for running requests in a browser
from your own code.

Configuration, backends, metrics and CLI reference:
[the main README](https://github.com/swissspidy/web-ai-evals#readme).
