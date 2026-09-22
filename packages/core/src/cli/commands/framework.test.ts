import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { z } from "zod";
import { createCliProgram } from "./framework.js";
import { CLI_COMMANDS } from "./registry.js";
import { readCountDataRows } from "./helpers.js";
import type { CliCommandContext, CliCommandSpec } from "./types.js";

const ENV_VARS = ["SAPPORTA_API_URL", "SAPPORTA_API_TOKEN"] as const;
const originalEnv = Object.fromEntries(
  ENV_VARS.map((name) => [name, process.env[name]]),
) as Record<(typeof ENV_VARS)[number], string | undefined>;

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of ENV_VARS) {
    const value = originalEnv[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("CLI command registry help", () => {
  function helpFor(args: string[]): string {
    const program = createCliProgram("0.0.0-test", CLI_COMMANDS) as Command;
    const target = args.reduce(
      (command, name) =>
        command.commands.find((candidate) => candidate.name() === name) ??
        command,
      program,
    );
    let output = "";
    target.configureOutput({
      writeOut: (chunk) => {
        output += chunk;
      },
      writeErr: (chunk) => {
        output += chunk;
      },
    });
    target.outputHelp();
    return output;
  }

  it("surfaces global options from the root command", () => {
    const help = helpFor([]);

    expect(help).toContain("--api-url <url>");
    expect(help).toContain("--api-token <token>");
    expect(help).toContain("--output <format>");
    expect(help).toContain("endpoints");
    expect(help).toContain("rows");
    expect(help).toContain("sql");
  });

  it("documents init targets outside the current directory", () => {
    const help = helpFor(["init"]);

    expect(help).toContain("Usage: sapporta init [options] <target>");
    expect(help).toContain("sapporta init ../apps/my-app");
  });

  it("documents row create payload input", () => {
    const help = helpFor(["rows", "create"]);

    expect(help).toContain("Usage: sapporta rows create [options] <table>");
    expect(help).toContain("--values <json>");
    expect(help).toContain(
      'sapporta rows create books --values \'{"title":"Relativity"}\'',
    );
  });

  it("documents row update payload input", () => {
    const help = helpFor(["rows", "update"]);

    expect(help).toContain(
      "Usage: sapporta rows update [options] <table> <id>",
    );
    expect(help).toContain("--values <json>");
    expect(help).toContain(
      'sapporta rows update books 123 --values \'{"author":"Albert Einstein"}\'',
    );
  });

  it("documents row list filters and sorting", () => {
    const help = helpFor(["rows", "list"]);

    expect(help).toContain("--limit <number>");
    expect(help).toContain("--page <number>");
    expect(help).toContain("--sort <columns>");
    expect(help).toContain("--where <json>");
  });

  it("documents deterministic count options", () => {
    const help = helpFor(["rows", "count"]);

    expect(help).toContain("Usage: sapporta rows count [options] <table>");
    expect(help).toContain("--group-by <column>");
    expect(help).toContain("--order <direction>");
    expect(help).toContain("--limit <number>");
    expect(help).toContain("--where <json>");
    expect(help).toContain("--limit 10");
  });

  it("documents table detail, indexes, and sample options", () => {
    expect(helpFor(["tables", "list"])).toContain("--detail");
    expect(helpFor(["tables", "indexes"])).toContain(
      "Usage: sapporta tables indexes [options] <table>",
    );

    const sampleHelp = helpFor(["tables", "sample"]);
    expect(sampleHelp).toContain("--limit <number>");
    expect(sampleHelp).toContain("--columns <columns>");
  });

  it("documents SQL query and execute options", () => {
    expect(helpFor(["sql", "query"])).toContain("--limit <number>");

    const executeHelp = helpFor(["sql", "execute"]);
    expect(executeHelp).toContain("--params <json>");
    expect(executeHelp).toContain("--dry-run");
  });
});

describe("count command output", () => {
  it("flattens explicit count results only at the table-rendering boundary", () => {
    expect(readCountDataRows({ data: { kind: "total", count: 8 } })).toEqual([
      { count: 8 },
    ]);
    expect(
      readCountDataRows({
        data: {
          kind: "grouped",
          groups: [{ value: "open", count: 3 }],
        },
      }),
    ).toEqual([{ value: "open", count: 3 }]);
  });

  it("rejects grouped options without a group column", async () => {
    const count = CLI_COMMANDS.find(
      (spec) => spec.name[0] === "rows" && spec.name[1] === "count",
    );
    if (!count) throw new Error("Count command not found");

    await expect(
      count.inputSchema.parseAsync({ table: "tasks", limit: "10" }),
    ).rejects.toThrow(/require --group-by/);
  });
});

describe("CLI command context credentials", () => {
  async function runProbe(
    globalOptions: readonly string[] = [],
  ): Promise<Pick<CliCommandContext, "apiUrl" | "apiToken">> {
    let observed: Pick<CliCommandContext, "apiUrl" | "apiToken"> | undefined;
    const probe: CliCommandSpec = {
      name: ["probe"],
      summary: "Inspect command context",
      inputSchema: z.object({}),
      run: async (_input, context) => {
        observed = {
          apiUrl: context.apiUrl,
          ...(context.apiToken ? { apiToken: context.apiToken } : {}),
        };
        return { data: [] };
      },
    };

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const program = createCliProgram("0.0.0-test", [probe]);
    await program.parseAsync([
      "node",
      "sapporta",
      "--output",
      "json",
      ...globalOptions,
      "probe",
    ]);

    if (!observed) {
      throw new Error("probe command did not run");
    }
    return observed;
  }

  it("uses API URL and token from env", async () => {
    process.env.SAPPORTA_API_URL = "https://env.example.com/";
    process.env.SAPPORTA_API_TOKEN = "env-token";

    await expect(runProbe()).resolves.toEqual({
      apiUrl: "https://env.example.com",
      apiToken: "env-token",
    });
  });

  it("lets API flags override env credentials", async () => {
    process.env.SAPPORTA_API_URL = "https://env.example.com";
    process.env.SAPPORTA_API_TOKEN = "env-token";

    await expect(
      runProbe([
        "--api-url",
        "https://flag.example.com/",
        "--api-token",
        "flag-token",
      ]),
    ).resolves.toEqual({
      apiUrl: "https://flag.example.com",
      apiToken: "flag-token",
    });
  });
});

describe("endpoints list from a flat project", () => {
  // A flat project has one package.json and no packages/ directory. The CLI
  // finds the API through the port in the root's .env.development.
  it("reads the running app's endpoints", async () => {
    delete process.env.SAPPORTA_API_URL;
    delete process.env.SAPPORTA_API_TOKEN;

    const requested: string[] = [];
    const server = createServer((req, res) => {
      requested.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          openapi: "3.1.0",
          info: { title: "flat-app", version: "0.0.0" },
          paths: {
            "/api/sample": {
              get: { summary: "List samples", responses: {} },
            },
          },
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "localhost", resolve),
    );
    const { port } = server.address() as AddressInfo;

    const root = mkdtempSync(join(tmpdir(), "sapporta-flat-project-"));
    writeFileSync(join(root, "sapporta.json"), "{}");
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "flat-app" }),
    );
    writeFileSync(
      join(root, ".env.development"),
      `SAPPORTA_API_PORT=${port}\n`,
    );
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const program = createCliProgram("0.0.0-test", CLI_COMMANDS);
      await program.parseAsync([
        "node",
        "sapporta",
        "--output",
        "json",
        "endpoints",
        "list",
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(root, { force: true, recursive: true });
    }

    expect(requested).toEqual(["/api/openapi.json"]);
    expect(log.mock.calls.flat().join("\n")).toContain("/api/sample");
  });
});
