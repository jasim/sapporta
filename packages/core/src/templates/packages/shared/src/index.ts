// Types, contracts, and pure helpers shared between the backend (root
// packages/api/) and the frontend (packages/frontend/src/). See ./CLAUDE.md for what
// belongs here and what does not. Add anything that would otherwise be
// re-declared on both sides of the client/server boundary and drift
// silently when one side changes.

export const APP_NAME = "__SLUG__";

export * from "./contracts/index.js";
