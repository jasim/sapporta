# Sapporta

Sapporta is a **library** for building database applications with TypeScript. It provides schema-as-code table definitions, auto-generated CRUD APIs, and a React admin UI.

## Library, Not Framework

Sapporta is modular and composable. The high-level features in Sapporta should be built by composing low-level primitives, which should be equally available for end users. It should be possible for end user to compose their own versions of high-level Sapporta feature using these primitives.

Every part of Sapporta must be overridable, extensible, or skippable. Projects own their entry points — `boot.ts` and `main.tsx` on both backend and frontend live in the project, not in Sapporta — and `@sapporta/server` on the backend and `@sapporta/frontend`, `@sapporta/grid`, and `@sapporta/ui` on the frontend export composable building blocks the project wires in itself.

## Stack

- **Runtime**: Node.js + TypeScript, tsx for dev
- **Backend**: Hono (HTTP), better-sqlite3 + Drizzle ORM (DB), Zod (validation) + sapporta-rest (a forked subset of ts-rest)
- **Frontend**: Vite + React 19 + Tailwind v4 + shadcn/ui + Zustand
- **Testing**: Vitest + better-sqlite3 (in-memory SQLite)

## Monorepo Structure

ARCHITECTURE.md is the full map: the module index of every package, the
grid layer stack, and the scaffold ownership model. The summary:

```
packages/cli/           sapporta — npx-able wrapper whose bin re-exports @sapporta/server/cli
packages/core/          @sapporta/server — schema-as-code tables, row engine, CRUD/meta APIs, CLI, and the project scaffold templates
packages/honest/        @sapporta/honest — Hono + ts-rest adapter for contract routing, request parsing, and OpenAPI output
packages/shared/        @sapporta/shared — leaf package: wire contracts, filter/query grammars, and pure helpers shared by server and browser
packages/grid/          @sapporta/grid — backend-agnostic grid engine, column presets, and lookup primitives
packages/frontend/      @sapporta/frontend — Sapporta-bound admin frontend: app shell, table and report pages, auth screens, boot wiring
packages/ui/            @sapporta/ui — UI primitives (Base UI wrappers) and small React utilities
```

Two directory names differ from their npm names: `packages/core` publishes as
`@sapporta/server`, and `packages/cli` publishes as `sapporta`.

Dependency direction between workspace packages (an arrow means "may import from"):

```
@sapporta/frontend  →  @sapporta/grid, @sapporta/ui, @sapporta/shared
@sapporta/grid      →  @sapporta/ui, @sapporta/shared
@sapporta/server    →  @sapporta/honest, @sapporta/shared
sapporta (cli)      →  @sapporta/server
```

`@sapporta/shared`, `@sapporta/ui`, and `@sapporta/honest` are leaves: they
import nothing else in the workspace.

## Programming Approach

Always fix root causes, not symptoms. Do not apply workarounds or ad-hoc patches — trace the issue to its architectural source before proposing a fix.

Do not use `any`. Use concrete types, generics, or `unknown`.

Commit messages should follow COMMIT-CONVENTIONS.md.

## User-Facing Writing

Apply this section only when editing or reviewing generated code, starter code,
examples, public documentation, comments intended for app programmers, or
user-facing messages.

Write from the application builder's perspective, not from the implementation's
perspective. Avoid exposing internal machinery, ownership models, generation
processes, or architecture taxonomy unless that is the explicit subject. Prefer
language that names the user's goal and what they can do next. Generated code
should read like ordinary intentional app code, not like an artifact explaining
how it was produced.
