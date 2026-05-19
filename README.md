# Sapporta

## CLI

Create a project with the canonical Sapporta CLI package:

```bash
npx sapporta init my-app
```

For a global install:

```bash
npm install -g sapporta
sapporta init my-app
```

For a project-local install:

```bash
npm install -D sapporta
npm exec sapporta -- check
```

## Watch build

```bash
pnpm dev
```

Rebuilds `@sapporta/server` and `@sapporta/ui` `dist/` output on every source change. `file:`-linked consumer projects pick up changes automatically.

## Other commands

```bash
pnpm test             # Run all tests
pnpm test:watch       # Tests in watch mode
pnpm typecheck        # TypeScript type checking
```

## AI coding tool skills

Install the Sapporta coding-agent skills from the public skills repo:

```bash
npx skills add https://github.com/jasim/sapporta-skills --global
```

To refresh an existing install later, run:

```bash
npx skills update sapporta --global
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) and [PUBLISHING.md](./PUBLISHING.md) for more.
