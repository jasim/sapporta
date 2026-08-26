# syntax=docker/dockerfile:1

# Keep these versions in one place so CI/CD can override them with
# `docker build --build-arg NODE_VERSION=... --build-arg PNPM_VERSION=...`.
# Node 22 includes the global `fetch` used by the healthcheck below.
ARG NODE_VERSION=22-bookworm-slim
ARG PNPM_VERSION=11.1.1

# Shared build image. `better-sqlite3` is a native dependency, so install the
# small Debian toolchain needed when pnpm has to compile or rebuild it.
FROM node:${NODE_VERSION} AS toolchain
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate

# Build the whole workspace: shared package, API TypeScript, then the Vite
# frontend. Package manifests are copied before source files so dependency
# layers stay cached when only application code changes.
#
# If you add another workspace package with its own dependencies, add its
# package.json to this manifest block and to the matching block in `prod-deps`.
FROM toolchain AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Install runtime workspace dependencies in a separate layer. Drizzle Kit is
# present because the container applies native Drizzle migrations before boot.
FROM toolchain AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

# Runtime image: production node_modules, compiled output, and the metadata
# Sapporta reads to find the project root. No toolchain, no sources beyond
# drizzle.config.ts.
#
# Keep pnpm out of this stage and out of CMD: pnpm 11 defaults
# `verify-deps-before-run` to `install`, so any `pnpm run` reinstalls the
# workspace at boot.
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app

# pnpm stores package contents under the root node_modules/.pnpm directory and
# links package-local node_modules entries into it, so copy both the root store
# and the package-local link directories used by the API at runtime.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=prod-deps --chown=node:node /app/packages/shared/node_modules ./packages/shared/node_modules

COPY --from=build --chown=node:node /app/packages/api/dist ./packages/api/dist
COPY --from=build --chown=node:node /app/packages/api/migrations ./packages/api/migrations
COPY --from=build --chown=node:node /app/packages/api/drizzle.config.ts ./packages/api/drizzle.config.ts
COPY --from=build --chown=node:node /app/packages/api/package.json ./packages/api/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/frontend/dist ./packages/frontend/dist
COPY --chown=node:node sapporta.json package.json pnpm-workspace.yaml ./

# Sapporta writes the SQLite database to /app/data. Mount it as a persistent
# volume in production, and if that mount is a bind mount, own it as uid 1000 on
# the host - a bind mount overrides the ownership set here. See DEPLOYMENT.md.
#
# chown /app because WORKDIR created it as root. Not -R: that would rewrite the
# pnpm store, which node only reads.
RUN chown node:node /app \
  && install -d -o node -g node /app/data

USER node
EXPOSE 3000
VOLUME ["/app/data"]

# `serve()` is the last statement in boot.js, so nothing listens until the
# schema loaded, migrations checked out, auth built, and every route mounted.
# Any HTTP reply therefore proves the process booted; only a connection failure
# or a 5xx means it did not. The check must not require 2xx: /health answers 401
# under SAPPORTA_HEALTH_POLICY=authenticated and 404 under `disabled`, and both
# are healthy processes. A 401 also proves the auth middleware is running.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.SAPPORTA_API_PORT || process.env.PORT || 3000) + '/health').then(r => process.exit(r.status >= 500 ? 1 : 0)).catch(() => process.exit(1))"

# `cd` first: Drizzle Kit resolves `out` against the working directory, not the
# config file. `exec` gives Node PID 1 so stop signals reach it, not this shell.
CMD ["sh", "-c", "cd /app/packages/api && ./node_modules/.bin/drizzle-kit migrate && cd /app && exec node packages/api/dist/boot.js"]
