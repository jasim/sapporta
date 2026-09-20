---
"@sapporta/server": minor
---

A generated project's root `package.json` now declares `@sapporta/server`, so
`pnpm exec sapporta ...` runs from the project root. The root declared no
dependencies at all, and the `sapporta` bin reached the project only through
`packages/api`. `pnpm exec` searches the current package and then PATH, never
an ancestor, so the root form that the generated `AGENTS.md`, `README.md`,
`.env.development`, and the agent skill all give failed on any machine without
a global install:

    [ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "sapporta" not found

The root pins the spec `packages/api` already resolves, so a project keeps one
CLI and one server version, and pnpm links the package it already installed
rather than adding a second copy.
