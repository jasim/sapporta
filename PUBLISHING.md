# Publishing

Published packages:

- `sapporta` — canonical CLI package
- `@sapporta/server` — server library and CLI implementation
- `@sapporta/shared` — shared contracts and helpers
- `@sapporta/honest` — Hono adapter for ts-rest contracts
- `@sapporta/ui` — React UI primitives
- `@sapporta/grid` — grid runtime and React grid components
- `@sapporta/frontend` — default React admin frontend

Uses [Changesets](https://github.com/changesets/changesets) for versioning.
Publishing is handled by `scripts/release.mjs` so npm browser/passkey
authentication can run interactively.

The monorepo root package is private (`@sapporta/monorepo`) and is never published.

## Setup

```bash
npm login
```

Use the normal npm CLI login flow. For accounts that authenticate with a
passkey, no OTP code is expected.

# Details on the workflow

Step 3 runs `scripts/release.mjs`. It builds the workspace, checks npm for each
package's exact local version, skips versions that already exist, and publishes
missing versions sequentially from their package directories with
`pnpm publish`. Publishing from the package directory matters because
`npm publish <path>` can be misinterpreted as a git URL. npm package versions
are immutable, so a changed package must get a new version before it can be
published again.

The release script attaches stdin to the terminal when possible so npm can run
the browser/passkey auth flow. Do not pass `--otp` for the normal passkey login
case.

Run the `vendor` step after `pnpm run version` because `@sapporta/server` ships snapshots of the dependency package manifests used by project scaffolding. If `pnpm install` needs to run in a non-interactive environment, use `CI=true pnpm install`.

For CLI-related releases, prefer `sapporta` as the user-facing package. Keep `@sapporta/server` as the owner of the CLI implementation and publish it when exports, command behavior, templates, or server APIs change.

To verify the publish path without uploading packages:

```bash
node scripts/release.mjs --dry-run
```

The release script sorts workspace packages by internal dependencies before
publishing. If the script ever needs to be bypassed, publish manually in the
same dependency-aware order: shared dependencies first, then packages that
depend on them, and the thin `sapporta` CLI package after `@sapporta/server`.

## Before publishing

Build and typecheck the workspace:

```bash
pnpm build
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


## Workflow

```bash
# 1. select packages, bump type, summary -> .changeset/*.md
pnpm changeset          
# 2. consume changesets → bump package.json, write CHANGELOG.md
pnpm run version        
pnpm --filter @sapporta/server vendor
pnpm install
git add .
git commit -m "Version packages for release"
# 3. build and publish unpublished package versions
pnpm release            
# 4. push release commit
git push                
```

