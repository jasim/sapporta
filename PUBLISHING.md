# Publishing

Published packages:

- `sapporta` — canonical CLI package
- `@sapporta/server` — server library and CLI implementation
- `@sapporta/ui` — React admin UI
- `@sapporta/shared` — shared contracts and helpers
- `@sapporta/honest` — Hono adapter for ts-rest contracts

Uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

The monorepo root package is private (`@sapporta/monorepo`) and is never published.

## Setup

```bash
npm login
```

## Workflow

```bash
pnpm changeset          # 1. select packages, bump type, summary -> .changeset/*.md
pnpm run version        # 2. consume changesets → bump package.json, write CHANGELOG.md
pnpm release            # 3. publish to npm, create git tags
git push --follow-tags  # 4. push commits + tags
```

Step 3 runs `changeset publish`, which publishes packages whose local version exceeds the registry version. Publish runs `npm publish` from each package directory (not `npm publish <path>`, which npm misinterprets as a git URL).

For CLI-related releases, prefer `sapporta` as the user-facing package. Keep `@sapporta/server` as the owner of the CLI implementation and publish it when exports, command behavior, templates, or server APIs change.

## Before publishing

Build and typecheck the workspace:

```bash
pnpm -r build
pnpm typecheck
```

For the canonical CLI package, verify the tarball contents before publishing:

```bash
pnpm --filter sapporta pack --dry-run
cd packages/cli && npm pack --dry-run
```

The `sapporta` tarball should stay thin: `bin/sapporta.mjs`, `package.json`, and `README.md`. It should depend on `@sapporta/server` rather than bundling or duplicating the CLI implementation.

After `pnpm run version`, inspect package metadata that matters to npm users:

```bash
npm view sapporta version description bin repository homepage license keywords --json
npm view @sapporta/server version bin exports --json
```

For a first publish of `sapporta`, confirm the npm name is available or owned by the correct npm account/org before running `pnpm release`.

## Semver bumps

- **patch**: bug fixes, internal refactors, docs
- **minor**: new features, new exports, CLI commands, first release of a package
- **major**: breaking API changes, removed exports, migration-requiring schema changes
