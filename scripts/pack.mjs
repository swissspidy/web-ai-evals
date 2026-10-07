// Builds every publishable package for release and packs it into packages-out/.
// The page runtime is minified and has no sourcemaps; pnpm pack replaces
// workspace:* with real versions. Publish the tarballs with `npm publish <file>`.
import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'packages-out');
// Dependency order, so a partial publish never leaves a package without its deps.
const dirs = ['packages/core', 'packages/page-runtime', 'packages/scorers', 'packages/report', 'packages/runner', 'integrations/promptfoo'];

const run = (cmd, args, cwd = root, env = {}) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

const pkgs = await Promise.all(dirs.map(async (dir) => JSON.parse(await readFile(path.join(root, dir, 'package.json'), 'utf8'))));
const versions = new Set(pkgs.map((p) => p.version));
if (versions.size !== 1) throw new Error(`packages have different versions: ${[...versions].join(', ')}`);
const [version] = versions;
const tag = process.env.RELEASE_TAG;
if (tag && tag !== `v${version}`) throw new Error(`tag ${tag} does not match package version ${version}`);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
run('pnpm', ['-r', 'run', 'build'], root, { MINIFY: '1', SOURCEMAP: '0' });

for (const dir of dirs) {
  const cwd = path.join(root, dir);
  await copyFile(path.join(root, 'LICENSE'), path.join(cwd, 'LICENSE'));
  try {
    run('pnpm', ['pack', '--pack-destination', out], cwd);
  } finally {
    await rm(path.join(cwd, 'LICENSE'));
  }
}

// pnpm pack names @scope/name@1.0.0 as scope-name-1.0.0.tgz.
const tarballs = pkgs.map((p) => `${p.name.replace('@', '').replace('/', '-')}-${version}.tgz`);
for (const f of tarballs) await access(path.join(out, f));
// The publish order, read by .github/workflows/release.yml.
await writeFile(path.join(out, 'order.txt'), tarballs.join('\n') + '\n');
console.log(`\npacked ${version} into packages-out/:\n${tarballs.map((f) => `  ${f}`).join('\n')}`);
