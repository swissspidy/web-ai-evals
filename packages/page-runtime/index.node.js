import { fileURLToPath } from 'node:url';

/** Directory with the built page runtime (index.html, runtime.js, chunks, ort/). */
export const pageRuntimeDir = fileURLToPath(new URL('./dist/www/', import.meta.url));
