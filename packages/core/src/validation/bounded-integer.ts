export type BoundedIntegerErrorFactory = (message: string) => Error;

export interface BoundedIntegerOptions {
  name: string;
  min: number;
  max?: number;
  makeError: BoundedIntegerErrorFactory;
}

export interface OptionalBoundedIntegerOptions extends BoundedIntegerOptions {
  blankAsUndefined?: boolean;
}

export interface RequiredBoundedIntegerOptions extends BoundedIntegerOptions {
  defaultValue: number;
}

type BoundedIntegerInput = string | number | undefined;

export function parseOptionalBoundedInteger(
  raw: BoundedIntegerInput,
  options: OptionalBoundedIntegerOptions,
): number | undefined {
  if (raw === undefined) return undefined;
  if (
    options.blankAsUndefined !== false &&
    typeof raw === "string" &&
    raw.trim() === ""
  ) {
    return undefined;
  }
  return parsePresentBoundedInteger(raw, options);
}

export function parseBoundedInteger(
  raw: BoundedIntegerInput,
  options: RequiredBoundedIntegerOptions,
): number {
  if (raw === undefined) return options.defaultValue;
  return parsePresentBoundedInteger(raw, options);
}

export function assertBoundedInteger(
  value: number,
  options: BoundedIntegerOptions,
): void {
  parsePresentBoundedInteger(value, options);
}

function parsePresentBoundedInteger(
  raw: string | number,
  options: BoundedIntegerOptions,
): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value < options.min) {
    throw options.makeError(errorMessage(raw, options));
  }
  if (options.max !== undefined && value > options.max) {
    throw options.makeError(errorMessage(raw, options));
  }
  return value;
}

function errorMessage(raw: string | number, options: BoundedIntegerOptions) {
  return `${options.name} must be an integer in ${rangeText(options)}, got ${JSON.stringify(raw)}`;
}

function rangeText(options: BoundedIntegerOptions): string {
  if (options.max === undefined) return `[${options.min}, +Infinity)`;
  return `[${options.min}, ${options.max}]`;
}
