# Changesets

This repository uses [changesets](https://github.com/changesets/changesets) to version and publish
the `web-ai-evals` package.

- Run `pnpm changeset` in a pull request that changes the package and pick a bump.
- When changesets land on `main`, the release workflow opens a "Version packages" pull request
  that bumps the version and updates `packages/web-ai-evals/CHANGELOG.md`.
- Merging that pull request publishes to npm with provenance and creates a GitHub release.

## Before the first release

The package sits at `0.0.0` in the repository. Nothing is published yet, and changesets computes
the next version from the manifest, so the `minor` in `initial-release.md` takes it to `0.1.0`.
`0.0.0` is never published.

## What the release workflow needs

- "Allow GitHub Actions to create and approve pull requests" enabled under Settings → Actions →
  General, so the action can open the "Version packages" pull request.
- npm trusted publishing: on npmjs.com, add this repository and `release.yml` as the package's
  trusted publisher. `changeset publish` runs `pnpm publish`, and pnpm 12 exchanges the job's OIDC
  token for a short-lived npm credential, so there is no npm secret. Provenance comes from
  `publishConfig.provenance` in the package.

A trusted publisher can only be added to a package that already exists, so the first release is
published by hand:

1. Wait for the workflow to open the "Version packages" pull request (`0.0.0` → `0.1.0`).
2. Check out that branch locally, then `npm login` and
   `pnpm install && pnpm --filter web-ai-evals publish --no-provenance`. Provenance needs a CI
   identity; releases from the workflow have it. `prepack` runs the release build.
3. On npmjs.com, add the trusted publisher (repository `swissspidy/web-ai-evals`, workflow
   `release.yml`). In the package settings, require two-factor authentication and disallow tokens.
4. Merge the pull request. `changeset publish` finds `0.1.0` already on npm and publishes nothing,
   so tag that release yourself: `git tag web-ai-evals@0.1.0 && git push origin web-ai-evals@0.1.0`,
   and create a GitHub release from it with the `CHANGELOG.md` entry.

From then on, merging the "Version packages" pull request is the whole release.
