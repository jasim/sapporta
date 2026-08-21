import { execFileSync } from "node:child_process";
import { ErrorCode, OperationError } from "../../errors.js";

export type ProgressLogger = (message: string) => void;

export const noopProgress: ProgressLogger = () => {};

export function logInitSection(progress: ProgressLogger, title: string): void {
  progress("\n");
  progress(`*** ${title}`);
  progress("");
}

export function logInitDetail(progress: ProgressLogger, message: string): void {
  progress(`- ${message}`);
}

export type InitCommandStdio = "ignore" | "inherit" | "capture";

/**
 * Returns the command's stdout, which is empty for every stdio mode except
 * "capture". Callers that only need the exit status ignore the return value;
 * `pnpm --version` needs the text.
 */
export type InitCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    stdio?: InitCommandStdio;
  },
) => string;

export const runInitCommand: InitCommandRunner = (command, args, options) => {
  const stdio = options.stdio ?? "ignore";
  const output = execFileSync(command, [...args], {
    cwd: options.cwd,
    stdio: stdio === "capture" ? ["ignore", "pipe", "pipe"] : stdio,
    encoding: "utf-8",
  });
  return output ?? "";
};

export function formatCommand(
  command: string,
  args: readonly string[],
): string {
  return [command, ...args].join(" ");
}

export type InitSetupStep =
  | "npm-registry-preflight"
  | "scaffold-write"
  | "pnpm-install"
  | "git-init"
  | "git-add"
  | "git-commit"
  | "sqlite-native-bindings"
  | "migration-generate"
  | "migration-apply"
  | "atomic-publish";

export class InitSetupError extends OperationError {
  constructor(
    public readonly step: InitSetupStep,
    message: string,
    code: string = ErrorCode.INIT_SETUP_FAILED,
  ) {
    super(message, code);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
