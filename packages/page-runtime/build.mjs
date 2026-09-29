import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const out = 'dist/www';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: { runtime: 'src/index.ts' },
  bundle: true,
  format: 'esm',
  splitting: true,
  platform: 'browser',
  target: 'es2022',
  outdir: out,
  chunkNames: 'chunks/[name]-[hash]',
  sourcemap: true,
  minify: process.env.MINIFY === '1',
  logLevel: 'warning',
});

await cp('www/index.html', `${out}/index.html`);

// Ship ONNX Runtime Web's Wasm so Transformers.js does not fetch it from a CDN.
const require = createRequire(import.meta.url);
const transformersDir = path.dirname(require.resolve('@huggingface/transformers'));
const ortDist = path.join(path.dirname(createRequire(transformersDir + '/').resolve('onnxruntime-web')), '');
await mkdir(`${out}/ort`, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  await cp(path.join(ortDist, f), `${out}/ort/${f}`);
}
console.log('page runtime built into', out);
