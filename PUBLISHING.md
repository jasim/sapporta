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

Before building, the release script aborts if `.changeset/` still holds
changesets (run `pnpm release:version` first), or if the release would publish
packages without also publishing `@sapporta/server` and `sapporta`. If a
release fails partway, run `pnpm release:publish` again: it skips the versions that
are already on npm and publishes the rest.

For CLI-related releases, prefer `sapporta` as the user-facing package. `@sapporta/server` owns the CLI implementation and is published with every release (see "Which packages a release publishes").

To verify the publish path without uploading packages:

```bash
node scripts/release.mjs --dry-run
```

The dry run makes the same checks as a real release, so it also aborts while
changesets are pending.

The release script sorts workspace packages by internal dependencies and
publishes `@sapporta/server` and then `sapporta` last, so a published server
never scaffolds projects with versions that are not on npm yet. If the script
ever needs to be bypassed, publish manually in the same order.

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

After `pnpm release:version`, inspect package metadata that matters to npm users:

```bash
npm view sapporta version description bin repository homepage license keywords --json
npm view @sapporta/server version bin exports --json
```

For a first publish of `sapporta`, confirm the npm name is available or owned by the correct npm account/org before running `pnpm release:publish`.

## Semver bumps

- **patch**: bug fixes, internal refactors, docs
- **minor**: new features, new exports, CLI commands, first release of a package
- **major**: breaking API changes, removed exports, migration-requiring schema changes


## Which packages a release publishes

Each release publishes three groups of packages:

1. Every package named in a pending changeset.
2. Every package that lists a released package in `dependencies` with
   `workspace:*`, and then the packages that depend on those, and so on.
   `workspace:*` is published as an exact version, so a dependent must be
   republished to use the new version. For example, a `@sapporta/ui` patch
   also releases `@sapporta/grid` and `@sapporta/frontend`. A
   `devDependencies` entry does not release the package that declares it. A
   peer dependency releases it only when the new version leaves the peer
   range. A package released this way always gets a patch bump, even when
   the dependency's bump is minor or major: a `@sapporta/honest` minor
   release gives `@sapporta/server` a patch.
3. `@sapporta/server` and `sapporta`, whenever anything is released. Server
   embeds the other packages' `package.json` files
   (`packages/core/src/vendored-package-snapshots`), and `sapporta init`
   scaffolds new projects with those versions. `sapporta` pins server.

Changesets computes groups 1 and 2. `pnpm release:version` (`scripts/version.mjs`)
adds group 3 by writing a patch changeset for `@sapporta/server` when no
changeset names it. That changeset is created at version time and is never
committed, so its changelog entry has no commit hash.

Write a changeset only for a package whose code changed. Do not write one
changeset naming every package: it releases packages that did not change. A
package released only through group 2 gets an "Updated dependencies"
changelog entry, so give it its own changeset if its behaviour changed.

`pnpm exec changeset status --verbose` shows groups 1 and 2 before versioning.
`pnpm release:version` also lists packages that changed since the last version
commit but that no changeset names, and asks before continuing (without a
terminal it continues). It then runs `changeset version`, so every
Changesets option applies as usual. If it fails partway, run it again: with no pending changesets it lists the
changed packages and only refreshes server's package snapshots and the
lockfile.

## Workflow

Sapporta is usually released by the release train in `../sapporta-devtools`:

```bash
cd ../sapporta-devtools
pnpm release-train
```

The train releases Sapporta together with the repositories that depend on it,
such as dbu6. It asks for a bump for every package that changed without a
changeset and writes that changeset from the commit subjects. Then it runs
`pnpm release:version`, commits "Version packages for release", runs `pnpm
release:publish`, and pushes. It reads this repository's state from `pnpm
release:status`, which prints each package's version, whether that version is
on npm, its pending bump, and the commits no changeset describes.

The same steps by hand:

```bash
# 1. with each change: select packages, bump type, summary -> .changeset/*.md
pnpm changeset
# 2. consume changesets, bump versions, write CHANGELOG.md,
#    refresh server's package snapshots, and update pnpm-lock.yaml
pnpm release:version
git add .
git commit -m "Version packages for release"
# 3. build and publish unpublished package versions
pnpm release:publish
# 4. push release commit
git push
```

The last release is the last commit whose subject starts with "Version
packages", so keep that subject on the version commit. The changesets need
not be committed before it.

If `pnpm install` needs to run in a non-interactive environment, run
`CI=true pnpm release:version`.
