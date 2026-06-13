# Contributing

Thanks for helping improve `babel-plugin-jsx-template-vars`. This project is
small, but changes can affect generated server-side templates, so we keep the
workflow explicit and test-backed.

## Branches

- `develop` is the normal integration branch.
- Feature and fix branches should branch from `develop`.
- Pull requests for normal development should target `develop`.
- `main` is the release branch.
- Release pull requests should merge `develop` into `main`.

Feature PRs into `develop` should use squash merges. Release PRs into `main`
should use merge commits so the release boundary remains visible.

The current historical development branch is `develop-0.0.10`; new maintenance
should converge on a plain `develop` branch before branch protection rules are
formalized.

## Pull requests

Before opening a PR, run:

```sh
npm test
npm run test:coverage
npm pack --dry-run
```

CI runs the same checks for code changes. Markdown-only changes still start CI,
but the test commands are skipped internally so required checks can report a
successful status.

Keep PRs focused. If a behavior change exposes an existing bug, include the
smallest regression test that would have caught it.

## Tests

Testing guidance lives in [docs/testing.md](docs/testing.md). In short:

- unit tests live beside the JavaScript file they cover
- transform-level tests cover the plugin as a whole
- language schema tests guard PHP and Handlebars preset drift
- test helpers live in `test-utils`

## Release flow

Release automation is intentionally not enabled yet. The intended release flow
is documented in [docs/workflow.md](docs/workflow.md).
