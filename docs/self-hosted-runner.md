# Self-hosted GPU runner (nightly drift checks)

Built-in models ship with the browser and change without notice. The nightly
workflow (`.github/workflows/nightly.yml`) runs a small suite on Chrome Stable,
Beta and Canary on a real machine every night. It compares each night with the
previous one and with the other channels.

GitHub-hosted runners can't do this. They have no GPU and no persistent
browser profile, and every night would download Gemini Nano again (about 4 GB).

## Hardware

Any machine that meets Chrome's requirements for Gemini Nano:

- a GPU with more than 4 GB of VRAM, or at least 16 GB RAM and 4 cores for CPU
  inference
- at least 22 GB of free disk per profile

A **Mac mini (Apple silicon, 16 GB or more)** is the simplest choice: it has
Metal WebGPU, Gemini Nano runs on the GPU, and it is quiet and cheap to leave
on. A Windows PC with a discrete GPU also works and is the only way to test
Edge's Phi-4-mini (Edge Dev or Canary). Linux works for Chrome; Edge's built-in
model isn't available on Linux.

## Setup (macOS)

1. Create a dedicated macOS user that is **logged in to a GUI session**.
   Headful Chrome needs a window server, so enable automatic login and turn
   off sleep: `sudo pmset -a sleep 0 displaysleep 0`.
2. Install Node 22+ and pnpm: `brew install node pnpm`.
3. Install Google Chrome, Chrome Beta and Chrome Canary from google.com/chrome.
   Playwright finds them in `/Applications`.
4. Register a GitHub Actions runner with the labels
   `self-hosted, gpu, web-ai-evals`. Install it as a **LaunchAgent**, not a
   LaunchDaemon, so it runs inside the GUI session:
   ```sh
   ./config.sh --url https://github.com/<owner>/web-ai-evals --token <token> \
     --labels gpu,web-ai-evals
   ./svc.sh install   # installs a LaunchAgent for the current user
   ./svc.sh start
   ```
5. Warm up the profiles once, which downloads the models:
   ```sh
   pnpm install && pnpm build
   pnpm wae doctor --config nightly.config.ts
   pnpm wae nightly --config nightly.config.ts --history ~/web-ai-evals-history
   ```
6. Optional: set the repository variable `WAE_HISTORY` to change where run
   history is kept. The default is `~/web-ai-evals-history`.

Profiles live in `~/.cache/web-ai-evals/profiles/<channel>`. Don't clean them
between runs, because the "model not re-downloaded" guarantee depends on them.

## What the nightly job reports

`web-ai-evals nightly` writes `<runId>.json`, `.html`, `.diff.html` and `.md`
into the history directory. The Markdown summary is also written to the job
summary. The job **fails (exit code 2)** when, compared with the previous night:

- a model version, model or built-in component version changes
  (`backend.modelVersion`, `backend.builtInComponents`), or
- a quality metric moves by at least 0.05 (`--score-threshold`), or
- median TTFT, latency or throughput changes by a factor of 1.5 or more
  (`--latency-ratio`), or
- a cell's status changes (for example, the model becomes unavailable).

Browser version changes are recorded but don't fail the job on their own. The
channel comparison (Stable vs Beta vs Canary) is informational and shows what
is coming to Stable.

A failed nightly job isn't a bug in itself. It tells you to look at the diff
page.

## Noise

Chrome doesn't let web pages set the Prompt API's temperature. Outputs vary
between runs, so the job flags score changes only above a threshold, and
changed outputs are listed rather than flagged. Raise `--score-threshold` if a
suite is small and noisy, or add `run.repeats` to average over several passes.
