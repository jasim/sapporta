# Dependency Package Snapshots

These package directories contain vendored package.json snapshots of Sapporta
library packages. `sapporta init` reads them to resolve scaffold dependency
versions and peer dependency specs.

They are refreshed by `pnpm vendor`. The core package's `pnpm build` and
`pnpm build:watch` scripts run `pnpm vendor` first, so normal build/dev
workflows keep these snapshots in sync with the source package.json files.

They are not copied into generated user projects. The package.json files that
are written to user projects live in this template tree as `package.json` and
`packages/*/package.json`.
