# Dependency Package Snapshots

These package directories contain vendored package.json snapshots of Sapporta
packages. `sapporta init` reads the library snapshots to resolve scaffold
dependency versions and peer dependency specs. The CLI reads the `cli` snapshot
to report the canonical `sapporta` npm package version.

They are refreshed by `pnpm vendor`. The core package's `pnpm build` and
`pnpm build:watch` scripts run `pnpm vendor` first, so normal build/dev
workflows keep these snapshots in sync with the source package.json files.

They are not templates and are not copied into generated user projects. The
package.json files that are written to user projects live in the template tree
(`packages/core/src/templates/`) as `package.json` and
`packages/*/package.json`.
