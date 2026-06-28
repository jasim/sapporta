import type { Command as CommanderCommand } from "commander";
import type { z } from "zod";
import type { SapportaCliClient } from "../client/app-client.js";
import type { OutputFormat } from "../render/output.js";

export type CliOptionKind = "string" | "boolean";

export interface CliArgumentSpec {
  name: string;
  required?: boolean;
  description?: string;
}

export interface CliOptionSpec {
  name: string;
  flag: string;
  description: string;
  kind: CliOptionKind;
}

export interface CliCommandResult {
  data: Record<string, unknown>[];
  message?: string;
  additionalOutput?: string;
  tableOutputHandled?: boolean;
  raw?: unknown;
}

export interface CliCommandContext {
  apiUrl: string;
  apiToken?: string;
  output: OutputFormat;
  projectDir?: string;
  client: SapportaCliClient;
}

export interface CliCommandSpec {
  name: readonly string[];
  summary: string;
  args?: readonly CliArgumentSpec[];
  options?: readonly CliOptionSpec[];
  examples?: readonly string[];
  inputSchema: z.ZodType<unknown>;
  run(
    input: Record<string, unknown>,
    context: CliCommandContext,
  ): Promise<CliCommandResult>;
}

export interface RegisteredCliCommand {
  spec: CliCommandSpec;
  command: CommanderCommand;
}
