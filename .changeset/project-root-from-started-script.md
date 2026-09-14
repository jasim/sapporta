---
"@sapporta/server": patch
---

`projectRoot()`, `projectPath()`, and `dataPath()` now work at the top of a
module in a server started from any working directory. Until now, code that
ran before `packages/api/runtime.ts` set the project root found the root by
walking up from the working directory. `boot.ts` imports the application's
modules before it opens the runtime, so a module that built a path when it
loaded, for example `const presets = dataPath("import-presets.json")` with a
relative `SAPPORTA_DATA_DIR`, failed with `projectRoot() called outside a
Sapporta project` when the server was started from `/`, as systemd does. Started
from inside a different Sapporta project, it took that project's root, and
startup then stopped when `runtime.ts` set the real one.

In this change, a root that has not been set yet is found by walking up from
the script the process was started with, such as `packages/api/dist/boot.js`,
and then from the working directory. This is the rule `runtime.ts` already
follows, so both find the same root. The working directory is still used when
the script is outside every project, as with `node -e`.
