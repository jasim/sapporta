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
