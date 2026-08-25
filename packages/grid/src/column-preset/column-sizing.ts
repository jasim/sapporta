import type { ColumnSchema } from "../core/types/schema";
import type { ColId, GridPath } from "../core/types/identity";
import { preset } from "./preset";
import type { ColumnWidth } from "./types";

export const DEFAULT_COLUMN_RESIZE_MIN_PX = 48;

export type ColumnSizingStorageKeyContext = {
  path: GridPath;
  levelName: string;
  schema: readonly ColumnSchema[];
};

export type ColumnSizingStorageKey =
  string | ((context: ColumnSizingStorageKeyContext) => string | undefined);

export type ColumnSizingOptions = {
  storageKey?: ColumnSizingStorageKey;
  enabled?: boolean;
  minPx?: number;
};

export type ResolvedColumnSizing = {
  enabled: boolean;
  storageKey?: string;
  minPx: number;
};

export type ColumnSizingOverrides = Record<ColId, number>;

export function resolveColumnSizing(
  options: ColumnSizingOptions | undefined,
  context: ColumnSizingStorageKeyContext,
): ResolvedColumnSizing {
  const storageKey = resolveStorageKey(options?.storageKey, context);
  const minPx = normalizeMinPx(options?.minPx);
  return {
    enabled: options?.enabled ?? storageKey !== undefined,
    storageKey,
    minPx,
  };
}

export function loadColumnSizingOverrides(
  sizing: ResolvedColumnSizing,
  schema: readonly ColumnSchema[],
): ColumnSizingOverrides {
  if (!sizing.enabled || !sizing.storageKey) return {};
  const raw = readLocalStorage(sizing.storageKey);
  if (raw === null) return {};
  try {
    return sanitizeColumnSizingOverrides(
      JSON.parse(raw) as unknown,
      schema,
      sizing.minPx,
    );
  } catch {
    return {};
  }
}

export function saveColumnSizingOverrides(
  sizing: ResolvedColumnSizing,
  schema: readonly ColumnSchema[],
  overrides: ColumnSizingOverrides,
): void {
  if (!sizing.enabled || !sizing.storageKey) return;
  writeLocalStorage(
    sizing.storageKey,
    JSON.stringify(
      sanitizeColumnSizingOverrides(overrides, schema, sizing.minPx),
    ),
  );
}

export function sanitizeColumnSizingOverrides(
  value: unknown,
  schema: readonly ColumnSchema[],
  minPx = DEFAULT_COLUMN_RESIZE_MIN_PX,
): ColumnSizingOverrides {
  const raw = persistedWidthsRecord(value);
  if (!raw) return {};

  const columnsById = new Map<ColId, ColumnSchema>(
    schema.map((column) => [column.id, column]),
  );
  const sanitized: ColumnSizingOverrides = {};
  for (const [colId, width] of Object.entries(raw)) {
    const column = columnsById.get(colId);
    if (!column) continue;
    if (typeof width !== "number" || !Number.isFinite(width)) continue;
    sanitized[colId] = clampColumnPixelWidth(column, width, minPx);
  }
  return sanitized;
}

export function columnSizingTemplateColumns(
  schema: readonly ColumnSchema[],
  overrides: ColumnSizingOverrides,
  minPx = DEFAULT_COLUMN_RESIZE_MIN_PX,
): string {
  return schema
    .map((column) => {
      const width = overrides[column.id];
      if (width === undefined)
        return trackForColumnWidth(preset(column)?.layout.width);
      return `${clampColumnPixelWidth(column, width, minPx)}px`;
    })
    .join(" ");
}

export function clampColumnPixelWidth(
  column: ColumnSchema,
  value: number,
  minPx = DEFAULT_COLUMN_RESIZE_MIN_PX,
): number {
  const bounds = columnWidthBounds(preset(column)?.layout.width);
  const minimum = Math.max(normalizeMinPx(minPx), bounds.min ?? 0);
  const boundedByMin = Math.max(minimum, Math.round(value));
  if (bounds.max === undefined || bounds.max < minimum) return boundedByMin;
  return Math.min(bounds.max, boundedByMin);
}

function resolveStorageKey(
  storageKey: ColumnSizingStorageKey | undefined,
  context: ColumnSizingStorageKeyContext,
): string | undefined {
  const key =
    typeof storageKey === "function" ? storageKey(context) : storageKey;
  return key && key.trim() !== "" ? key : undefined;
}

function normalizeMinPx(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_COLUMN_RESIZE_MIN_PX;
  }
  return Math.max(1, Math.round(value));
}

function persistedWidthsRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if ("widths" in value) {
    return isRecord(value.widths) ? value.widths : null;
  }
  return value;
}

function columnWidthBounds(width: ColumnWidth | undefined): {
  min?: number;
  max?: number;
} {
  if (!width) return {};
  if (typeof width === "object" && "track" in width) return {};
  if (typeof width === "object") {
    return {
      min: finiteNumber(width.min),
      max: finiteNumber(width.max),
    };
  }

  switch (width) {
    case "compact":
      return { min: 48 };
    case "content":
      return {};
    case "fill":
      return { min: 0 };
    case "numeric":
      return { min: 80, max: 112 };
    case "date":
      return { min: 112, max: 128 };
    case "timestamp":
      return { min: 144, max: 160 };
    case "enum":
      return { min: 96 };
    case "foreignKey":
      return { min: 144, max: 220 };
  }
}

export function trackForColumnWidth(width: ColumnWidth | undefined): string {
  if (!width) return "minmax(0, 1fr)";
  if (typeof width === "object" && "track" in width) return width.track;
  if (typeof width === "object") {
    const min = width.min ?? 0;
    const max = width.max ?? width.ideal;
    return `minmax(${min}px, ${max === undefined ? "1fr" : `${max}px`})`;
  }
  switch (width) {
    case "compact":
      return "minmax(48px, max-content)";
    case "content":
      return "max-content";
    case "fill":
      return "minmax(0, 1fr)";
    case "numeric":
      return "minmax(80px, 112px)";
    case "date":
      return "minmax(112px, 128px)";
    case "timestamp":
      return "minmax(144px, 160px)";
    case "enum":
      return "minmax(96px, max-content)";
    case "foreignKey":
      return "minmax(144px, 220px)";
  }
}

function finiteNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function readLocalStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Visual preferences are best-effort.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
