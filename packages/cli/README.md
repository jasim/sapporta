# sapporta

Canonical CLI for Sapporta projects.

## Usage

```bash
npx sapporta init my-app
```

Global install:

```bash
npm install -g sapporta
sapporta init my-app
```

Project-local install:

```bash
npm install -D sapporta
npm exec sapporta -- endpoints list
```

The package is intentionally thin. It provides the `sapporta` executable and delegates command behavior to `@sapporta/server`.
