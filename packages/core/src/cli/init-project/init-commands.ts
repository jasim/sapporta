import { execFileSync } from "node:child_process";

export type InitCommandStdio = "ignore" | "inherit";

export type InitCommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    stdio?: InitCommandStdio;
  },
) => void;

export const runInitCommand: InitCommandRunner = (command, args, options) => {
  execFileSync(command, [...args], {
    cwd: options.cwd,
    stdio: options.stdio ?? "ignore",
  });
};

export function formatCommand(
  command: string,
  args: readonly string[],
): string {
  return [command, ...args].join(" ");
}
