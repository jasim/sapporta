import { ErrorCode, OperationError } from "../../introspect/types.js";
import { z } from "zod";

export function jsonOption(flagName: string): z.ZodType<unknown> {
  return z.preprocess((value) => parseJsonOption(value, flagName), z.unknown());
}

export function optionalJsonObject(
  flagName: string,
): z.ZodOptional<z.ZodType<Record<string, unknown>>> {
  return z
    .preprocess(
      (value) => {
        if (value === undefined) return undefined;
        const parsed = parseJsonOption(value, flagName);
        if (!isRecord(parsed)) {
          throw new OperationError(
            `--${flagName} must be a JSON object`,
            ErrorCode.VALIDATION_FAILED,
          );
        }
        return parsed;
      },
      z.record(z.string(), z.unknown()),
    )
    .optional();
}

export function optionalJsonArray(
  flagName: string,
): z.ZodOptional<z.ZodType<unknown[]>> {
  return z
    .preprocess((value) => {
      if (value === undefined) return undefined;
      const parsed = parseJsonOption(value, flagName);
      if (!Array.isArray(parsed)) {
        throw new OperationError(
          `--${flagName} must be a JSON array`,
          ErrorCode.VALIDATION_FAILED,
        );
      }
      return parsed;
    }, z.array(z.unknown()))
    .optional();
}

export function optionalPositiveInteger(name: string) {
  return z
    .preprocess((value) => {
      if (value === undefined) return undefined;
      if (typeof value === "number") return value;
      if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        throw new OperationError(
          `--${name} must be a positive integer`,
          ErrorCode.BAD_LIMIT,
        );
      }
      return Number(value);
    }, z.number().int().positive())
    .optional();
}

export function requiredString(name: string) {
  return z.string().min(1, `${name} is required`);
}

export function resultFromResponse(
  response: unknown,
  extractRows: (response: unknown) => Record<string, unknown>[],
  opts: { message?: string } = {},
) {
  return {
    data: extractRows(response),
    raw: response,
    ...opts,
  };
}

export function readDataRows(response: unknown): Record<string, unknown>[] {
  if (!isRecord(response)) return [];
  const data = response.data;
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) return [data];
  return [];
}

export function readTableListRows(
  response: unknown,
): Record<string, unknown>[] {
  if (!isRecord(response) || !Array.isArray(response.tables)) return [];
  return response.tables.filter(isRecord).map((table) => ({
    name: table.name ?? "",
    label: table.label ?? "",
    columns: Array.isArray(table.columns) ? table.columns.length : 0,
    source: table.source ?? "",
    rowCount: table.rowCount ?? "",
  }));
}

export function readRecordArrayResponse(
  response: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(response)) return response.filter(isRecord);
  if (isRecord(response)) {
    const data = response.data;
    if (Array.isArray(data)) return data.filter(isRecord);
  }
  return [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonOption(value: unknown, flagName: string): unknown {
  if (typeof value !== "string") {
    throw new OperationError(
      `--${flagName} must be provided as JSON text`,
      ErrorCode.VALIDATION_FAILED,
    );
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new OperationError(
      `Invalid JSON for --${flagName}`,
      ErrorCode.INVALID_JSON,
    );
  }
}
