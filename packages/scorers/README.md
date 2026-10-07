# @web-ai-evals/scorers

Scorers for [web-ai-evals](https://github.com/swissspidy/web-ai-evals): `exactMatch`, `contains`, `regex`,
`rougeL`, `chrF`, `jsonValid`, `jsonSchema`, `jsonFieldMatch`,
`classification`, `embeddingSimilarity`, `llmJudge` and `custom`.

```ts
import { classification, rougeL } from '@web-ai-evals/scorers';
```

Scoring runs in Node, so API keys for `llmJudge` never reach the page.
`embeddingSimilarity` uses `@huggingface/transformers` by default. Install it
yourself if you use that scorer, or pass your own `embed` function.

See [the main README](https://github.com/swissspidy/web-ai-evals#readme).
