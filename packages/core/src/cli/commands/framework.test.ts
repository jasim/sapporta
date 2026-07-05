import { afterEach, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { z } from "zod";
import { createCliProgram } from "./framework.js";
import { CLI_COMMANDS } from "./registry.js";
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
