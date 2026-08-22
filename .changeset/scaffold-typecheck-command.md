---
"@sapporta/server": minor
---

A generated project now has a `typecheck` command, and `pnpm build` runs it.

`packages/frontend` built with a bare `vite build`, which strips types with
esbuild and never typechecks, and the package shipped no `typecheck` script. So
`pnpm build` reported success on frontend code carrying real type errors, and
nothing in the project named a command that would find them — two separate
agent sessions had to construct `tsc --noEmit` themselves, then found four and
nine errors that a green build had hidden.

`packages/frontend` gains `typecheck: "tsc --noEmit"`. Unlike the API it needs
no `pretypecheck`: its tsconfig maps the workspace shared package to
`../shared/src`, not `../shared/dist`, so it typechecks without a prior build.
The root gains a `typecheck` that fans out to shared, API, and frontend.

Root `build` now runs `pnpm typecheck` first, so a type-broken frontend fails
the build instead of passing it, and fails before anything is emitted rather
than leaving a stale `packages/frontend/dist` behind. This costs a `--noEmit`
pass over shared and API before the emitting one; a clean scaffold builds in
about 11s where it took about 5s.

Existing projects are unaffected. The scaffold refresh deliberately never
rewrites an existing project's `scripts`, so a project generated before this
release picks the commands up only by hand.
