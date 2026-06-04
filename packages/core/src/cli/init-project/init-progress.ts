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
