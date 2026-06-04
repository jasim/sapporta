# Sapporta

Sapporta is a **library** for building database applications with TypeScript. It provides schema-as-code table definitions, auto-generated CRUD APIs, and a React admin UI.

## Library, Not Framework

Sapporta is modular and composable. The high-level features in Sapporta should be built by composing low-level primitives, which should be equally available for end users. It should be possible for end user to compose their own versions of high-level Sapporta feature using these primitives. 

Every part of Sapporta must be overridable, extensible, or skippable. Projects own their entry points — `boot.ts` and `main.tsx` on both backend and frontend live in the project, not in Sapporta — and `@sapporta/core` and `@sapporta/ui` export composable building blocks the project wires in itself.

## Stack

- **Runtime**: Node.js + TypeScript, tsx for dev
- **Backend**: Hono (HTTP), better-sqlite3 + Drizzle ORM (DB), Zod (validation) + sapporta-rest (a forked subset of ts-rest)
- **Frontend**: Vite + React 19 + Tailwind v4 + shadcn/ui + Zustand
- **Testing**: Vitest + better-sqlite3 (in-memory SQLite)

## Monorepo Structure

```
packages/cli/           sapporta — canonical npm CLI package that exposes the `sapporta` command
packages/core/          @sapporta/server — server library, schema-as-code, CRUD/meta/report APIs, project scaffolding, and CLI implementation
packages/honest/        @sapporta/honest — Hono + ts-rest adapter for contract routing, request parsing, and OpenAPI output
packages/shared/        @sapporta/shared — browser/server-safe contracts, shared types, filters, date helpers, and row-id utilities
packages/ui/            @sapporta/ui — React admin UI, CRUD screens, report views, sidebar shell, and grid components
```

## Programming Approach

Always fix root causes, not symptoms. Do not apply workarounds or ad-hoc patches — trace the issue to its architectural source before proposing a fix.

Do not use `any`. Use concrete types, generics, or `unknown`.

Commit messages should follow COMMIT-CONVENTIONS.md.