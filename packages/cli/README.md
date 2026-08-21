# sapporta

Canonical CLI for Sapporta projects.

## Requirements

pnpm 11 or later, because `sapporta init` generates a pnpm workspace whose
settings live in `pnpm-workspace.yaml`. Earlier pnpm versions read those
settings from the root package.json and resolve a different dependency tree.

## Usage

```bash
npx sapporta init my-app
```

Global install:

```bash
npm install -g sapporta
sapporta init my-app
```

Project-local install:

```bash
npm install -D sapporta
npm exec sapporta -- endpoints list
```

For API-backed data commands, set `SAPPORTA_API_URL` when the app API is not on `http://localhost:3000`. For protected apps, expose `SAPPORTA_API_TOKEN` to the agent or session. Use `--api-url` for one-off overrides; avoid passing raw tokens on the command line unless there is no safer option.

The package is intentionally thin. It provides the `sapporta` executable and delegates command behavior to `@sapporta/server`.

For deterministic single-table totals and grouped counts, see
[Count Queries](../../docs/count-queries.md).
