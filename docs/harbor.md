# Harbor integration: assessment

Harbor (github.com/laude-institute/harbor, v0.23, September 2026) is an
evaluation framework for agents. We looked at whether web-ai-evals could plug
in as a Harbor **environment** so that Harbor users can run tasks against
in-browser models.

## How Harbor models the world

- A **task** is a directory containing `instruction.md`, `task.toml`,
  `environment/` (a Dockerfile, a docker-compose file or an Apptainer
  definition), optionally `solution/solve.sh`, and `tests/test.sh`. The test
  script writes a reward to `/logs/verifier/reward.txt`, or to `reward.json`
  for multi-dimensional rewards.
- An **environment** is a machine the agent can run shell commands in.
  `BaseEnvironment` defines `start`, `stop`, `exec(command, cwd, env,
  timeout_sec, user)`, `upload_file/dir` and `download_file/dir`, plus
  optional capabilities: GPUs, network policy, SSH streaming. There are about
  30 implementations (docker, podman, daytona, modal, e2b, ec2, gke, ssh, …).
  Custom environments load from an import path:
  `harbor run -e my_module:MyEnv`.
- An **agent** either runs inside the environment (`BaseInstalledAgent`) or
  on the host, acting only through `environment.exec` (`BaseAgent`).
- Browsers already appear in two places, both inside the shell-and-files
  model:
  - Harbor's own computer-use agent starts Xvfb and Chromium inside the
    environment and drives it with `exec`.
  - The `cua-cloud` and `use-computer` environments are remote desktops.

## Can a "browser environment" be added?

**Technically yes, but it would be the wrong abstraction.**

A `BrowserEnvironment` could wrap a GPU host that has Chrome and web-ai-evals
installed, reached over SSH (the existing `ssh` environment is the template).
`exec` would run `web-ai-evals run …` and `download_dir` would fetch the
results. That works, but it gains nothing from Harbor:

| Harbor assumes | web-ai-evals needs |
|---|---|
| Unit of work: an agent solves an instruction; a verifier scores the final state | Unit of work: one prompt → one model output, thousands per run |
| One container per trial | One long-lived browser per run, with the model loaded once (loading Gemini Nano from disk takes seconds; a download takes minutes) |
| Output: a reward, optionally multi-dimensional | Output: quality plus TTFT, tokens/s, cold start, memory, environment (browser/model version, GPU) |
| Isolation and reproducibility come from the container image | The *uncontrolled* environment is the point: the user's browser, GPU driver and silently updated built-in model |
| GPU through provider-specific support (Modal, Daytona, GKE, …) | WebGPU through a real GPU driver in a real (headful) browser on real hardware |
| Access through `exec` and files only; no page, `evaluate` or CDP primitive | Playwright access to the page (`evaluate`, trusted clicks for user activation, bindings for progress) |

## Recommendation

1. **Don't build a Harbor environment now.** Document the gap, which is this
   page.
2. If Harbor users want a browser model as the **agent's model**, the right
   seam is a model provider that talks to web-ai-evals' `BrowserSession`
   through a small local HTTP bridge (OpenAI-compatible
   `/v1/chat/completions`). Harbor agents already call model APIs, so this
   works with every Harbor environment. It's a small follow-up if there is
   demand: `BrowserSession.run()` already provides everything the bridge
   needs.
3. For **agentic browser tasks** (an agent drives a website), Harbor's
   existing computer-use agents and remote-desktop environments already fit.
   web-ai-evals doesn't need to be involved.

Revisit this if Harbor adds a first-class browser or page primitive to
`BaseEnvironment`, or if it adds per-sample metrics alongside rewards.
