---
"@sapporta/frontend": minor
---

The agent setup prompt copied from the account profile page now has the agent
use the CLI and the authenticated command a project already has. It told the
agent to run `pnpm install sapporta` unless a project-local CLI existed, and a
generated app ships the `sapporta` bin in `packages/api` through
`@sapporta/server`, where `pnpm exec sapporta` at the workspace root does not
find it; the agent then added a dependency to the root `package.json`. It also
told the agent to update `AGENTS.md` with the authenticated command even when
the project's agent docs already gave one. The prompt now reads the agent docs
first, looks for a workspace package that provides the bin, and installs the
CLI or edits `AGENTS.md` only when neither is there.
