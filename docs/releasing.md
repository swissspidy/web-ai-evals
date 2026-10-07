# Releasing

All six packages share one version and are published together:
`@web-ai-evals/core`, `page-runtime`, `scorers`, `report`, `runner` and
`promptfoo`.

`node scripts/pack.mjs` builds everything for release (the page runtime
minified, without sourcemaps), copies the root `LICENSE` into each package and
packs them into `packages-out/`. `pnpm pack` replaces `workspace:*` with the
real version. `packages-out/order.txt` lists the tarballs in dependency order.

## Every release

1. Bump `version` in every package (they must match; the pack script checks):
   ```sh
   pnpm -r exec npm version 0.2.0 --no-git-tag-version
   ```
2. Commit, merge to `main`, then tag and push:
   ```sh
   git tag v0.2.0 && git push origin v0.2.0
   ```
3. The `Release` workflow (`.github/workflows/release.yml`) packs and
   publishes with npm trusted publishing, with provenance. It checks that the
   tag matches the package version and skips versions already on npm, so you
   can re-run a failed release.

## First release (one time)

npm only lets you configure trusted publishing for a package that already
exists, so publish 0.1.0 by hand:

1. Create the `web-ai-evals` organization on npmjs.com (free for public
   packages) and log in: `npm login`.
2. Pack and publish:
   ```sh
   pnpm install && pnpm release:pack
   cd packages-out
   for f in $(cat order.txt); do npm publish "$f" --access public; done
   ```
3. For each package on npmjs.com, go to *Settings → Trusted publishing* and
   add GitHub Actions with repository `swissspidy/web-ai-evals` and workflow
   `release.yml`.
4. Optional: in each package's settings, require 2FA and disallow tokens, so
   only the workflow can publish.

From then on, use the steps under "Every release".
