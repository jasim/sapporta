/**
 * End-to-end test for `sapporta init`.
 *
 * Exercises the full project lifecycle: scaffold → add schema → compile →
 * boot server → CRUD via HTTP → SPA fallback. Runs against a real temp
 * directory with real pnpm install, tsc, and node — no mocks.
 *
 * Run with: pnpm test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const MONOREPO_ROOT = join(import.meta.dirname, "..");

/**
 * Announce a slow setup phase and print the elapsed time when it finishes.
 * Uses stderr directly so progress streams live past Vitest's console capture,
 * giving the user a mental model of why `beforeAll` takes ~60-90s.
 */
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  process.stderr.write(`[e2e setup] ${label}…\n`);
  const t0 = Date.now();
  const result = await fn();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(`[e2e setup] ${label} — ${secs}s\n`);
  return result;
}

/**
 * `beforeAll` runs inside a Vitest worker; blocking its event loop for more
 * than ~60s starves the worker→main RPC heartbeat and fails teardown with
 * "Timeout calling onTaskUpdate" even when every test passed. So commands
 * that take long enough to trip that threshold (pnpm install, tsc) must run
 * via async spawn, not execSync.
 */
function run(
  command: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => chunks.push(c));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `\`${command} ${args.join(" ")}\` timed out after ${opts.timeoutMs}ms`,
        ),
      );
    }, opts.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const output = Buffer.concat(chunks).toString();
      reject(
        new Error(
          `\`${command} ${args.join(" ")}\` exited with code ${code}${
            signal ? ` (signal ${signal})` : ""
          }\n${output}`,
        ),
      );
    });
  });
}

/** Find a free TCP port using the bind-to-0 trick. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("Could not get port")));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/** Poll a URL until it responds 200 with JSON, or timeout. */
async function waitForServer(
  url: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && ct.includes("application/json")) return;
    } catch {
      // Server not ready yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

describe("sapporta init — end-to-end", () => {
  let projectDir: string;
  let serverProcess: ChildProcess;
  let serverOutput: string[] = [];
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    process.stderr.write(
      "[e2e setup] scaffolding a full project on a real filesystem — expect ~60-90s\n",
    );

    // 1. Create temp parent directory; init will create the project dir inside it
    const parentDir = mkdtempSync(join(tmpdir(), "sapporta-e2e-"));
    projectDir = join(parentDir, "test-project");

    const env = {
      ...process.env,
      SAPPORTA_DEV_MODE_PACKAGE_ROOT: MONOREPO_ROOT,
    };

    // 2. Run sapporta init (creates test-project/, scaffolds + runs pnpm install)
    await step("sapporta init (scaffolds project + pnpm install)", () =>
      run(
        "node",
        [join(MONOREPO_ROOT, "packages/core/bin/sapporta.mjs"), "init", "test-project"],
        { cwd: parentDir, env, timeoutMs: 120_000 },
      ),
    );
    expect(existsSync(join(projectDir, "Dockerfile"))).toBe(true);
    expect(existsSync(join(projectDir, ".dockerignore"))).toBe(true);
    expect(readFileSync(join(projectDir, "Dockerfile"), "utf-8")).toContain(
      "CMD [\"node\", \"packages/api/dist/boot.js\"]",
    );
    const apiTsconfig = readFileSync(
      join(projectDir, "packages", "api", "tsconfig.json"),
      "utf-8",
    );
    expect(apiTsconfig).toContain('"test-project-shared": ["../shared/dist/index.d.ts"]');
    expect(apiTsconfig).not.toContain("../shared/src/index.ts");

    // 2b. Ensure better-sqlite3 native bindings are built. pnpm's
    //     content-addressable store may reuse a cached package without
    //     re-running its install script, leaving the .node binary missing.
    await step("pnpm rebuild better-sqlite3", () =>
      run("pnpm", ["rebuild", "better-sqlite3"], {
        cwd: projectDir,
        env,
        timeoutMs: 60_000,
      }),
    );

    // 3. Write a schema file so we have a table to test CRUD against
    mkdirSync(join(projectDir, "packages", "api", "schema"), { recursive: true });
    writeFileSync(
      join(projectDir, "packages", "api", "schema", "tasks.ts"),
      [
        'import { table, timestamp } from "@sapporta/server/table";',
        'import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";',
        "",
        "export const tasks = table({",
        '  drizzle: sqliteTable("tasks", {',
        '    id: integer("id").primaryKey({ autoIncrement: true }),',
        '    title: text("title").notNull(),',
        '    status: text("status").notNull(),',
        '    created_at: timestamp("created_at"),',
        '    updated_at: timestamp("updated_at"),',
        "  }),",
        "  meta: {",
        '    label: "Tasks",',
        "    selects: [",
        '      { type: "select", column: "status", options: ["todo", "in_progress", "done"] },',
        "    ],",
        "  },",
        "});",
        "",
        "export default tasks;",
        "",
      ].join("\n"),
    );

    // 4. Compile the scaffolded workspace packages needed by the API.
    //    The SPA serving behavior is tested with a fallback index.html below,
    //    so this intentionally skips the full Vite build.
    await step("pnpm workspace builds (shared + api)", async () => {
      await run("pnpm", ["--filter", "./packages/shared", "build"], {
        cwd: projectDir,
        env,
        timeoutMs: 60_000,
      });
      await run("pnpm", ["--filter", "./packages/api", "build"], {
        cwd: projectDir,
        env,
        timeoutMs: 60_000,
      });
    });

    // 5. Create a minimal packages/frontend/dist/index.html for SPA fallback test
    //    (skipping the full Vite build — we're testing the serving mechanism,
    //    not React rendering)
    mkdirSync(join(projectDir, "packages", "frontend", "dist"), { recursive: true });
    writeFileSync(
      join(projectDir, "packages", "frontend", "dist", "index.html"),
      '<!doctype html><html><body><div id="root"></div></body></html>\n',
    );

    // 6. Start the server on a free port
    port = await getFreePort();
    baseUrl = `http://localhost:${port}`;

    await step("boot scaffolded server", async () => {
      serverProcess = spawn("node", ["packages/api/dist/boot.js"], {
        cwd: projectDir,
        env: { ...env, PORT: String(port) },
        stdio: "pipe",
      });

      serverProcess.stdout?.on("data", (chunk: Buffer) =>
        serverOutput.push(chunk.toString()),
      );
      serverProcess.stderr?.on("data", (chunk: Buffer) =>
        serverOutput.push(chunk.toString()),
      );

      try {
        await waitForServer(`${baseUrl}/api/meta/tables`);
      } catch (err) {
        console.error("Server failed to start. Output:\n" + serverOutput.join(""));
        throw err;
      }
    });
  }, 180_000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
    }
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  // ── Schema discovery ──────────────────────────────────────────────────

  it("GET /api/meta/tables lists the tasks table", async () => {
    const res = await fetch(`${baseUrl}/api/meta/tables`);
    expect(res.status).toBe(200);

    const body = await res.json();
    const tableNames = body.tables.map((t: any) => t.name);
    expect(tableNames).toContain("tasks");
  });

  // ── CRUD cycle ────────────────────────────────────────────────────────

  let createdId: number;

  it("POST /api/tables/tasks creates a row", async () => {
    const res = await fetch(`${baseUrl}/api/tables/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Write tests", status: "todo" }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.data.title).toBe("Write tests");
    expect(body.data.status).toBe("todo");
    expect(body.data.id).toBeGreaterThan(0);
    createdId = body.data.id;
  });

  it("GET /api/tables/tasks returns the created row", async () => {
    const res = await fetch(`${baseUrl}/api/tables/tasks`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.some((r: any) => r.title === "Write tests")).toBe(true);
  });

  it("GET /api/tables/tasks/:id returns a single row", async () => {
    const res = await fetch(`${baseUrl}/api/tables/tasks/${createdId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.id).toBe(createdId);
    expect(body.data.title).toBe("Write tests");
  });

  // ── Sample app route ──────────────────────────────────────────────────

  it("GET /api/hello returns the scaffolded sample route", async () => {
    const res = await fetch(`${baseUrl}/api/hello`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.message).toBe("Hello from test-project");
  });

  // ── SPA fallback ──────────────────────────────────────────────────────

  it("GET / serves the frontend index.html", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('<div id="root">');
  });

  it("GET /nonexistent-path falls back to index.html (SPA routing)", async () => {
    const res = await fetch(`${baseUrl}/some/client/route`);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('<div id="root">');
  });
});
