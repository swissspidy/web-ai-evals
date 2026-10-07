# @web-ai-evals/page-runtime

The in-page part of [web-ai-evals](https://github.com/swissspidy/web-ai-evals): a prebuilt bundle with backend
adapters for Chrome and Edge built-in AI (Prompt API, Summarizer, Writer,
Rewriter, Translator, Classifier), WebLLM and Transformers.js. It reports
availability and download progress and times each request.

`@web-ai-evals/runner` serves this bundle into the browser. The Node entry
point only exports `pageRuntimeDir`, the directory with the built files.
WebLLM, Transformers.js and ONNX Runtime Web's Wasm are bundled, so the page
fetches nothing but model weights.
