# nightly-built-in

## sentiment

| Backend | Model | Browser | Status | accuracy | TTFT p50 | Latency p50 | Tokens/s p50 |
|---|---|---|---|---:|---:|---:|---:|
| prompt-api | v3Nano | chrome 154.0.8037.57 | ok | 1.000 | 1.30 s | 1.35 s | 63.1 |
| prompt-api | v3Nano | chrome-beta 155.0.8059.12 | ok | 1.000 | 1.25 s | 1.27 s | 67.5 |

## extraction

| Backend | Model | Browser | Status | fields | TTFT p50 | Latency p50 | Tokens/s p50 |
|---|---|---|---|---:|---:|---:|---:|
| prompt-api | v3Nano | chrome 154.0.8037.57 | ok | 0.975 | 1.27 s | 4.33 s | 12.9 |
| prompt-api | v3Nano | chrome-beta 155.0.8059.12 | ok | 0.975 | 1.32 s | 4.58 s | 12.1 |

## summarization

| Backend | Model | Browser | Status | rougeL | TTFT p50 | Latency p50 | Tokens/s p50 |
|---|---|---|---|---:|---:|---:|---:|
| prompt-api | v3Nano | chrome 154.0.8037.57 | ok | 0.346 | 1.31 s | 5.51 s | 12.3 |
| summarizer | v3Nano | chrome 154.0.8037.57 | ok | 0.166 | 1.21 s | 29.2 s | 11.4 |
| prompt-api | v3Nano | chrome-beta 155.0.8059.12 | ok | 0.332 | 1.29 s | 5.27 s | 12.1 |
| summarizer | v3Nano | chrome-beta 155.0.8059.12 | ok | 0.160 | 1.18 s | 23.3 s | 11.2 |

## Drift since the previous nightly run

# Diff 2026-09-29T16-40-37-93bdb9 → 2026-09-29T16-52-57-74e6a8

No flagged changes.

### extraction/prompt-api/chrome

- browser: 154.0.8037.57 → 154.0.8037.57; model: v3Nano 2025.08.14.1358 (component 2025.8.21.1028) → v3Nano 2025.08.14.1358 (component 2025.8.21.1028)
- fields: 1.000 → 0.975 (-0.025)
- jsonSchema: 1.000 → 1.000 (+0.000)
- outputs changed: 1/10

### summarization/prompt-api/chrome

- browser: 154.0.8037.57 → 154.0.8037.57; model: v3Nano 2025.08.14.1358 (component 2025.8.21.1028) → v3Nano 2025.08.14.1358 (component 2025.8.21.1028)
- rougeL: 0.383 → 0.346 (-0.036)
- words: 41.000 → 45.333 (+4.333)
- outputs changed: 6/6

### summarization/summarizer/chrome

- browser: 154.0.8037.57 → 154.0.8037.57; model: v3Nano 2025.08.14.1358 (component 2025.8.21.1028) → v3Nano 2025.08.14.1358 (component 2025.8.21.1028)
- rougeL: 0.152 → 0.166 (+0.014)
- words: 226.500 → 219.000 (-7.500)
- outputs changed: 6/6

### extraction/prompt-api/chrome-beta

- browser: 155.0.8059.12 → 155.0.8059.12; model: v3Nano 2025.08.14.1358 (component 2025.8.21.1028) → v3Nano 2025.08.14.1358 (component 2025.8.21.1028)
- fields: 1.000 → 0.975 (-0.025)
- jsonSchema: 1.000 → 1.000 (+0.000)
- outputs changed: 1/10

### summarization/prompt-api/chrome-beta

- browser: 155.0.8059.12 → 155.0.8059.12; model: v3Nano 2025.08.14.1358 (component 2025.8.21.1028) → v3Nano 2025.08.14.1358 (component 2025.8.21.1028)
- rougeL: 0.356 → 0.332 (-0.024)
- words: 42.333 → 41.000 (-1.333)
- outputs changed: 6/6

### summarization/summarizer/chrome-beta

- browser: 155.0.8059.12 → 155.0.8059.12; model: v3Nano 2025.08.14.1358 (component 2025.8.21.1028) → v3Nano 2025.08.14.1358 (component 2025.8.21.1028)
- rougeL: 0.160 → 0.160 (-0.000)
- words: 224.833 → 202.333 (-22.500)
- outputs changed: 6/6


## Channel comparison (informational)

### chrome vs chrome-beta

No flagged changes.

### summarization/prompt-api (chrome → chrome-beta)

- browser: 154.0.8037.57 → 155.0.8059.12; model: v3Nano 2025.08.14.1358 (component 2025.8.21.1028) → v3Nano 2025.08.14.1358 (component 2025.8.21.1028)
- rougeL: 0.346 → 0.332 (-0.015)
- words: 45.333 → 41.000 (-4.333)
- outputs changed: 6/6

### summarization/summarizer (chrome → chrome-beta)

- browser: 154.0.8037.57 → 155.0.8059.12; model: v3Nano 2025.08.14.1358 (component 2025.8.21.1028) → v3Nano 2025.08.14.1358 (component 2025.8.21.1028)
- rougeL: 0.166 → 0.160 (-0.006)
- words: 219.000 → 202.333 (-16.667)
- outputs changed: 6/6
