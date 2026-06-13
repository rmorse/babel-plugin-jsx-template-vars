# Project workflow

This document describes the intended branch, CI, and release workflow for
maintainers.

## Branch model

The project uses a two-branch integration model:

- `develop` is the active development branch.
- `main` is the release branch.

Create feature and fix branches from `develop`, then open pull requests back
into `develop`. Squash-merge those pull requests once CI is green.

When `develop` is ready to release, open a release pull request from `develop`
to `main`. Merge release PRs with a merge commit so the release boundary remains
visible in history.

The current historical branch name is `develop-0.0.10`. Before enforcing branch
rules, create or rename to a plain `develop` branch and make it the default
development target.

## CI

CI lives in `.github/workflows/ci.yml`.

It runs on:

- every pull request
- pushes to `develop`
- pushes to `main`
- manual `workflow_dispatch` runs

For code changes, CI runs:

```sh
npm ci
npm test
npm run test:coverage
npm pack --dry-run
```

`npm pack --dry-run` is part of CI because this package keeps tests beside
source files. It verifies that `.npmignore` continues to exclude test-only files
from published packages.

CI reads the Node.js version from `.nvmrc`. Keep that file pinned to an exact
version so npm lockfile behavior does not drift as new Node patch releases ship.

## Docs-only changes

CI should always start, even for documentation-only changes. Workflow-level path
filters can leave required checks pending on GitHub, so the workflow performs an
internal changed-file check instead.

When every changed file is Markdown (`*.md`), CI exits successfully without
running the test commands. If any non-Markdown file changed, the full checks run.

## CI security

The CI workflow should stay conservative:

- use `npm ci`, not `npm install`
- keep exact dependency versions in `package.json`
- commit `package-lock.json`
- use `permissions: contents: read` by default
- do not use `pull_request_target` for test workflows
- pin GitHub Actions to full commit SHAs

When updating pinned actions, resolve the release tag to its commit SHA and
update the comment beside the `uses:` line.

## Release process

Release publishing is not automated yet. The target release flow is:

1. Prepare a release PR from `develop` to `main`.
2. Include the version bump and release notes in that PR.
3. Wait for CI to pass.
4. Merge the PR into `main` with a merge commit.
5. Create an annotated tag such as `v0.1.0`.
6. Publish to npm from a dedicated release workflow.

The preferred publishing model is npm trusted publishing with GitHub Actions
OIDC, not a long-lived `NPM_TOKEN`. Configure the trusted publisher in npm
before adding an automated publish workflow.

Release workflows should run on GitHub-hosted runners and should avoid package
manager caching during publish jobs.
