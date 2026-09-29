# sapporta

Canonical CLI for Sapporta projects.

## Requirements

pnpm 11 or later, because `sapporta init` generates a pnpm workspace whose
settings live in `pnpm-workspace.yaml`. Earlier pnpm versions read those
settings from the root package.json and resolve a different dependency tree.

## Usage

Create a project:

```bash
pnpm dlx sapporta@latest init my-app
```

Inside a project, run the project-local binary from the project root, so
commands match the installed framework version. Projects created by
`sapporta init` already have it through `@sapporta/server`:

```bash
pnpm exec sapporta endpoints list
```

Do not install `sapporta` globally. A global copy stays at the version you
installed and drifts from the project's `@sapporta/server`.

For API-backed data commands, set `SAPPORTA_API_URL` when the app API is not on `http://localhost:3000`. For protected apps, expose `SAPPORTA_API_TOKEN` to the agent or session. Use `--api-url` for one-off overrides; avoid passing raw tokens on the command line unless there is no safer option.

The package is intentionally thin. It provides the `sapporta` executable and delegates command behavior to `@sapporta/server`.

For deterministic single-table totals and grouped counts, see
[Count Queries](../../docs/count-queries.md).
