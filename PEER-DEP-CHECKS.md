# Peer Dependency Checks

Sapporta passes ecosystem objects across package boundaries: Hono apps, Drizzle tables, Zod schemas, React components, router state, Zustand stores, and SQLite connections. These packages are identity-sensitive — if two packages resolve different physical copies, TypeScript rejects valid code and runtimes fail.

## Quick Local Checks

Run after changing package manifests, scaffold templates, exported types, or dependency versions:

```bash
pnpm -r build
pnpm typecheck
pnpm check:public-declarations
pnpm check:peer-singletons
```

`pnpm -r build` must run before `check:public-declarations` because that check inspects emitted `.d.ts` files under `dist/`.

## `check:public-declarations`

```bash
pnpm check:public-declarations
```

Scans built declaration files for internal packages that must not appear in the public type surface.

Currently checks `@sapporta/server` declarations for:

- `commander`
- `winston`

If a declaration mentions an internal package, that package becomes part of the public API and forces users to install a compatible type identity for an implementation detail.

## `check:peer-singletons`

```bash
pnpm check:peer-singletons
```

Inspects the installed dependency graph and verifies each identity-sensitive package resolves to one physical package path.

Checks:

- `hono`
- `drizzle-orm`
- `better-sqlite3`
- `zod`
- `@sapporta/rest-core`
- `@js-temporal/polyfill`
- `react`
- `react-dom`
- `react-router-dom`
- `zustand`

Peer dependency declarations express intent only. This check verifies the actual installed graph, catching duplicate React, Hono, Zod, Drizzle, etc.

To check another pnpm project root:

```bash
node scripts/check-peer-singletons.mjs /path/to/project
```

## Compatibility Matrix Harness

Creates a temporary copy of the repo, installs dependencies under a specific version scenario, then runs:

```bash
pnpm -r build
pnpm typecheck
pnpm check:public-declarations
pnpm check:peer-singletons
pnpm test
```

Run before widening peer ranges, publishing, or changing scaffold dependency policy.

### Current Lockfile

```bash
pnpm check:peer-compat:lock
```

Installs from the current lockfile and runs the full sequence.

### Minimum Supported Versions

```bash
pnpm check:peer-compat:min
```

Pins peer-sensitive packages to their minimum supported versions, then runs the full sequence. Proves lower bounds like `react: ^19.1.0` or `hono: ^4.7.4` are real.

### Latest Versions Within Ranges

```bash
pnpm check:peer-compat:latest
```

Updates peer-sensitive packages to the latest versions allowed by declared ranges, then runs the full sequence. Catches ranges that are too wide for actual type compatibility.

## Dry Runs

See what a compatibility script would do without running the expensive commands:

```bash
node scripts/check-peer-compat.mjs lock --dry-run
node scripts/check-peer-compat.mjs minimum --dry-run
node scripts/check-peer-compat.mjs latest-in-range --dry-run
```

Use when editing the harness itself.

## When To Run What

Everyday package or scaffold dependency edits:

```bash
pnpm -r build
pnpm typecheck
pnpm check:public-declarations
pnpm check:peer-singletons
pnpm test
```

Before publishing:

```bash
pnpm check:peer-compat:lock
pnpm check:peer-compat:min
pnpm check:peer-compat:latest
```

The compatibility scripts are too slow for every small edit — use them as CI/release gates.

## What These Checks Do Not Prove

They do not compare package.json files to a hardcoded copy of the policy (that would be tautological). They prove observable outcomes:

- public declarations do not leak selected implementation dependencies
- installed package graphs do not duplicate selected shared identities
- supported peer version scenarios can install, build, typecheck, and pass tests
