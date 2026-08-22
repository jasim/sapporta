import type { z } from "zod";
import type { SapportaCliClient } from "../client/app-client.js";
import type { CliRuntimeConfig } from "../runtime-config.js";

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

export interface CliCommandContext extends CliRuntimeConfig {
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

export interface CliProgram {
  help(): void;
  parseAsync(argv?: readonly string[]): Promise<CliProgram>;
}
