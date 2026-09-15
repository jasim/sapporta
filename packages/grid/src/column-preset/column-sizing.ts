import type { ColumnSchema } from "../core/types/schema";
import type { ColId, GridPath } from "../core/types/identity";
import { preset } from "./preset";
import type {
  ColumnWidth,
  ColumnWidthMinimums,
  NamedColumnWidth,
} from "./types";

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
  /** The narrowest a column can be dragged to. */
  minPx?: number;
  /** Floors for the named default widths of columns nobody has sized. */
  minWidths?: ColumnWidthMinimums;
};

export type ResolvedColumnSizing = {
  enabled: boolean;
  storageKey?: string;
  minPx: number;
  minWidths: ColumnWidthMinimums;
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
    minWidths: options?.minWidths ?? {},
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

  const knownColumnIds = new Set<ColId>(schema.map((column) => column.id));
  const sanitized: ColumnSizingOverrides = {};
  for (const [colId, width] of Object.entries(raw)) {
    if (!knownColumnIds.has(colId)) continue;
    if (typeof width !== "number" || !Number.isFinite(width)) continue;
    sanitized[colId] = clampColumnPixelWidth(width, minPx);
  }
  return sanitized;
}

export function columnSizingTemplateColumns(
  schema: readonly ColumnSchema[],
  overrides: ColumnSizingOverrides,
  minPx = DEFAULT_COLUMN_RESIZE_MIN_PX,
  minWidths?: ColumnWidthMinimums,
): string {
  return schema
    .map((column) => {
      const width = overrides[column.id];
      if (width === undefined)
        return trackForColumnWidth(preset(column)?.layout.width, minWidths);
      return `${clampColumnPixelWidth(width, minPx)}px`;
    })
    .join(" ");
}

/**
 * A width in this map was set by dragging a column edge, so it is already the
 * answer to how wide that column should be. The preset's `min` and `max` answer
 * a different question - how to size a column nobody has sized - and feed
 * `trackForColumnWidth` alone. Clamping an explicit width to them would leave a
 * timestamp column 16px of travel between its floor and ceiling, which reads as
 * a resize handle that does not work. Only the grid's own floor applies, so a
 * column cannot be dragged away to nothing.
 */
export function clampColumnPixelWidth(
  value: number,
  minPx = DEFAULT_COLUMN_RESIZE_MIN_PX,
): number {
  return Math.max(normalizeMinPx(minPx), Math.round(value));
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

/**
 * The track each named width resolves to: a pixel floor and either a pixel
 * ceiling or a keyword. `content` has no floor of its own, so it stays a bare
 * `max-content` unless an app gives it one.
 */
const NAMED_WIDTH_TRACKS: Record<
  NamedColumnWidth,
  { min: number | null; max: number | "max-content" | "1fr" }
> = {
  compact: { min: 48, max: "max-content" },
  content: { min: null, max: "max-content" },
  fill: { min: 0, max: "1fr" },
  numeric: { min: 80, max: 112 },
  date: { min: 112, max: 128 },
  timestamp: { min: 144, max: 160 },
  enum: { min: 96, max: "max-content" },
  foreignKey: { min: 144, max: 220 },
};

export function trackForColumnWidth(
  width: ColumnWidth | undefined,
  minWidths?: ColumnWidthMinimums,
): string {
  if (!width) return "minmax(0, 1fr)";
  if (typeof width === "object" && "track" in width) return width.track;
  if (typeof width === "object") {
    const min = width.min ?? 0;
    const max = width.max ?? width.ideal;
    return `minmax(${min}px, ${max === undefined ? "1fr" : `${max}px`})`;
  }
  const track = NAMED_WIDTH_TRACKS[width];
  const floor = minWidths?.[width];
  const min =
    floor === undefined || !Number.isFinite(floor)
      ? track.min
      : Math.max(track.min ?? 0, Math.round(floor));
  const max =
    typeof track.max === "number" ? Math.max(track.max, min ?? 0) : track.max;
  const maxTrack = typeof max === "number" ? `${max}px` : max;
  if (min === null) return maxTrack;
  return `minmax(${min === 0 ? "0" : `${min}px`}, ${maxTrack})`;
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
