# Development

## Requirements

pnpm 11 or later, for this checkout and for every project scaffolded from it.
pnpm 11 removed the `pnpm` field in package.json, so workspace settings and
source-link dependency overrides are only read from `pnpm-workspace.yaml`.

## Monorepo Layout

See ARCHITECTURE.md for the package roster, the module index of each
package, and the dependency rules between them.

## Commands

```bash
pnpm dev              # Start development mode
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm test:watch       # Run tests in watch mode
pnpm typecheck        # TypeScript type checking
pnpm check:module-index  # ARCHITECTURE.md module tables match package exports
```

Create a local app from the current checkout when testing library changes:

```bash
pnpm sapporta init ../my-app
```

## Scaffold Refresh

`pnpm scaffold:refresh` is internal maintainer tooling for testing changes to
`packages/core/src/templates/` against an existing Sapporta project. It is not a
public project upgrade command and is intentionally source-checkout-dependent.

External projects are the primary workflow:

```bash
pnpm scaffold:refresh /absolute/path/to/external-project
pnpm scaffold:refresh /absolute/path/to/external-project --dry-run
```

Repo-local fixtures can also be refreshed:

```bash
pnpm scaffold:refresh examples/playground-app
```

The tool validates the target before writing, overwrites only scaffold files
marked as framework-owned, skips example/custom code, and conservatively merges
scaffold-managed package dependencies.
