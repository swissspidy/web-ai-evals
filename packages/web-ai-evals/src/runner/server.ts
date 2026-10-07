import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory with the built page runtime (index.html, runtime.js, chunks, ort/). */
export const pageRuntimeDir = fileURLToPath(new URL('../www/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
};

export interface RuntimeServer {
  url: string;
  close(): Promise<void>;
}

/**
 * Serve the page runtime on 127.0.0.1 (a secure context). Cross-origin
 * isolation headers enable Wasm threads and measureUserAgentSpecificMemory().
 * `credentialless` COEP still allows model downloads from Hugging Face / CDNs.
 */
export async function startRuntimeServer(port: number, root = pageRuntimeDir): Promise<RuntimeServer> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'content-length': st.size,
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'credentialless',
        'cache-control': 'no-cache',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
  } catch (err) {
    // Another web-ai-evals process already serves the runtime on this port (same origin,
    // same model caches): share it rather than fail.
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && (await isRuntime(port))) {
      return { url: `http://127.0.0.1:${port}/`, close: async () => {} };
    }
    throw err;
  }
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function isRuntime(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok && (await res.text()).includes('web-ai-evals page runtime');
  } catch {
    return false;
  }
}
