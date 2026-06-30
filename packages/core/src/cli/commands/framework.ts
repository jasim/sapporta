import { Command } from "commander";
import { OperationError } from "../../introspect/types.js";
import { SapportaCliClient } from "../client/app-client.js";
import {
  renderCommandError,
  renderCommandResult,
  resolveOutputFormat,
} from "../render/output.js";
import type { CliCommandContext, CliCommandSpec, CliProgram } from "./types.js";

const GROUP_DESCRIPTIONS: Record<string, string> = {
  api: "Call arbitrary app endpoints",
  endpoints: "Discover app endpoints",
  rows: "Work with table records",
  sql: "Run SQL through the app API",
  tables: "Inspect table definitions and samples",
};

export function createCliProgram(
  version: string,
  commands: readonly CliCommandSpec[],
): CliProgram {
  const program = new Command("sapporta")
    .version(version)
    .option("--api-url <url>", "Server URL (default: http://localhost:3000)")
    .option(
      "--api-token <token>",
      "Bearer token for authenticated API requests",
    )
    .option("--project-dir <path>", "Project root directory")
    .option("--output <format>", "Output format: table or json");

  for (const spec of commands) {
    registerCommand(program, spec);
  }

  return program;
}

function registerCommand(program: Command, spec: CliCommandSpec): void {
  const path = spec.name;
  if (path.length === 0) return;

  let parent = program;
  for (let i = 0; i < path.length - 1; i++) {
    parent = findOrCreateGroup(parent, path[i]);
  }

  const leafName = path[path.length - 1];
  const command = parent.command(leafName).description(spec.summary);

  for (const arg of spec.args ?? []) {
    const rendered = arg.required ? `<${arg.name}>` : `[${arg.name}]`;
    command.argument(rendered, arg.description);
  }

  for (const option of spec.options ?? []) {
    command.option(option.flag, option.description);
  }

  if (spec.examples && spec.examples.length > 0) {
    command.addHelpText(
      "after",
      `\nExamples:\n${spec.examples.map((example) => `  ${example}`).join("\n")}`,
    );
  }

  command.action(async (...received: unknown[]) => {
    const output = safeResolveOutput(program);
    try {
      const commandOptions = readCommanderOptions(received);
      const input = buildCommandInput(spec, received, commandOptions);
      const context = createCommandContext(program, output);
      const result = await spec.run(input, context);
      renderCommandResult(result, output);
    } catch (err) {
      renderCommandError(err, output);
    }
  });
}

function findOrCreateGroup(parent: Command, name: string): Command {
  const existing = parent.commands.find(
    (candidate) => candidate.name() === name,
  );
  if (existing) return existing;
  const command = parent.command(name);
  const description = GROUP_DESCRIPTIONS[name];
  if (description) command.description(description);
  return command;
}

function buildCommandInput(
  spec: CliCommandSpec,
  received: readonly unknown[],
  commandOptions: Record<string, unknown>,
): Record<string, unknown> {
  const positionalCount = spec.args?.length ?? 0;
  const positionals = received.slice(0, positionalCount);
  const input: Record<string, unknown> = {};

  for (let i = 0; i < positionalCount; i++) {
    const arg = spec.args?.[i];
    if (!arg) continue;
    input[arg.name] = positionals[i];
  }

  for (const option of spec.options ?? []) {
    if (option.name in commandOptions) {
      input[option.name] = commandOptions[option.name];
    }
  }

  return input;
}

function createCommandContext(
  program: Command,
  output: CliCommandContext["output"],
): CliCommandContext {
  const options = readRecord(program.opts());
  const apiUrl = readString(options.apiUrl) ?? "http://localhost:3000";
  const apiToken = readString(options.apiToken);
  const projectDir = readString(options.projectDir);

  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    ...(apiToken ? { apiToken } : {}),
    ...(projectDir ? { projectDir } : {}),
    output,
    client: new SapportaCliClient({
      apiUrl: apiUrl.replace(/\/+$/, ""),
      ...(apiToken ? { apiToken } : {}),
    }),
  };
}

function safeResolveOutput(program: Command): CliCommandContext["output"] {
  try {
    return resolveOutputFormat(readRecord(program.opts()));
  } catch (err) {
    if (err instanceof OperationError) {
      renderCommandError(err, "table");
    }
    throw err;
  }
}

function readCommanderOptions(
  received: readonly unknown[],
): Record<string, unknown> {
  const possibleOptions = received.at(-2);
  return readRecord(possibleOptions);
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
