import { describe, expect, it } from "vitest";
import { createCliProgram } from "./framework.js";
import { CLI_COMMANDS } from "./registry.js";

describe("CLI command registry help", () => {
  function helpFor(args: string[]): string {
    const program = createCliProgram("0.0.0-test", CLI_COMMANDS);
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
    expect(help).toContain("--project-dir <path>");
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
