# Development

## Global CLI Installation

Symlink `bin/sapporta` into your PATH:

```bash
ln -sf /path/to/sapporta/packages/core/bin/sapporta /usr/local/bin/sapporta
```

Runs compiled `dist/cli/index.js`. In dev, tsc runs in watch mode so dist is always up to date.

## Running `sapporta init` from the Monorepo

`sapporta init` scaffolds a project and pins `@sapporta/server` to the version in `packages/core/package.json`. When running from the monorepo, the dev tree may have drifted past the last-published npm version — templates reference exports that don't exist in the published release yet.

Set `SAPPORTA_PACKAGE_ROOT` to the monorepo root so `create-project` writes `link:` specs instead of version pins:

```bash
SAPPORTA_PACKAGE_ROOT=/path/to/sapporta sapporta init <name>
```

Or patch the scaffolded project afterward: set `@sapporta/server` to `link:/path/to/sapporta/packages/core` in its `package.json` and re-run `pnpm install`.

## Integration Fixtures

`src/integration/fixtures/` contains example schema/actions/reports/views files used by integration tests. These mirror the `code/src/` layout of a real project.
