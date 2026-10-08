# Example suites

Four suites, written for this project and released under CC0-1.0 (see
[LICENSE](LICENSE)). `index.ts` exports them as `SuiteConfig`s.

| Suite | Examples | Hard | Task | Scorers |
|---|---|---|---|---|
| `sentiment` | 300 | 140 | three-way classification of short reviews and statements | accuracy, macro-F1 |
| `extraction` | 150 | 90 | restaurant booking message → JSON (`name`, `date`, `city`, `guests`) | field accuracy, schema validity |
| `translation` | 200 | 80 | English → German | chrF, exact reference |
| `summarization` | 60 | 12 | one-to-two sentence summary of a ~110-word news-style article | ROUGE-L, word count |

Hard examples carry `"meta": {"difficulty": "hard"}`:

- **Sentiment:** sarcasm, negation, litotes, mixed verdicts with a clear lean,
  neutral facts with emotional words.
- **Extraction:** written-out dates, guest counts that need arithmetic,
  distractor numbers and cities, corrected details, bookings under someone
  else's name.
- **Translation:** idioms, du/Sie register, separable verbs, false friends,
  German number and time formats, long two-clause sentences.
- **Summarization:** buried leads, competing claims, reversals, and studies
  whose headline effect isn't significant.

New examples are appended, so ids stay stable. A run with `limit: N` uses the
first N examples, which are the original, easier ones. Leave `limit` off to
compare models: with a few dozen examples, differences of a few points are
noise.
