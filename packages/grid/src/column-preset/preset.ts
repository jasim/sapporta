import type { CellEditorProps, ColumnSchema } from "../grid/types/schema";
import type {
  BuiltInColumnPresetKind,
  ColumnAlign,
  ColumnPresetKind,
  ColumnWidth,
  NumberColorRule,
  SelectOption,
  TextDisplayMode,
  ZeroDisplay,
} from "./types";
import type { SearchLookup } from "../lookup/cache/search-lookup";
import type { ValueLookup } from "../lookup/cache/value-lookup";
import type { ColumnPresetRuntime } from "./runtime";

export const GRID_COLUMN_PRESET_RUNTIME: unique symbol = Symbol(
  "sapporta.gridColumnPreset.runtime",
);

type RuntimeColumn<TMeta = unknown> = ColumnSchema & {
  [GRID_COLUMN_PRESET_RUNTIME]?: ColumnPresetRuntime<TMeta>;
};

export type ColumnPresetLayout = {
  align: ColumnAlign;
  width: ColumnWidth;
};

type PresetBase = {
  layout: ColumnPresetLayout;
};

export type IdentifierPreset = PresetBase & { kind: "identifier" };

export type TextPreset = PresetBase & {
  kind: "text";
  text: { display?: TextDisplayMode };
};

export type NumberDisplay = {
  colorRule?: NumberColorRule;
  zeroDisplay?: ZeroDisplay;
  strong: boolean;
};

export type NumberPreset = PresetBase & {
  kind: "number";
  number: NumberDisplay;
};

export type CurrencyPreset = PresetBase & {
  kind: "currency";
  currency: NumberDisplay;
};

export type PercentagePreset = PresetBase & {
  kind: "percentage";
  percentage: NumberDisplay;
};

export type DatePreset = PresetBase & { kind: "date" };

export type BooleanPreset = PresetBase & { kind: "boolean" };

export type SelectPreset = PresetBase & {
  kind: "select";
  select: { options: readonly SelectOption[] };
};

export type LookupCapabilities = {
  valueLookup: ValueLookup;
  searchLookup?: SearchLookup;
};

export type LookupPreset = PresetBase & {
  kind: "lookupValue";
  lookup: LookupCapabilities;
};

export type ForeignKeyPreset = PresetBase & {
  kind: "foreignKey";
  lookup: LookupCapabilities;
};

export type CustomPreset = PresetBase & {
  kind: Exclude<ColumnPresetKind, BuiltInColumnPresetKind>;
};

export type ColumnPreset =
  | IdentifierPreset
  | TextPreset
  | NumberPreset
  | CurrencyPreset
  | PercentagePreset
  | DatePreset
  | BooleanPreset
  | SelectPreset
  | LookupPreset
  | ForeignKeyPreset
  | CustomPreset;

export function preset(column: ColumnSchema): ColumnPreset | undefined {
  return presetRuntime(column)?.preset;
}

export function presetRuntime<TMeta = unknown>(
  column: ColumnSchema,
): ColumnPresetRuntime<TMeta> | undefined {
  return (column as RuntimeColumn<TMeta>)[GRID_COLUMN_PRESET_RUNTIME];
}

export function meta<TMeta = unknown>(column: ColumnSchema): TMeta | undefined {
  return column.meta as TMeta | undefined;
}

export function kind(column: ColumnSchema): ColumnPresetKind | undefined {
  return preset(column)?.kind;
}

export function width(column: ColumnSchema): ColumnWidth | undefined {
  return preset(column)?.layout.width;
}

export function parse(
  column: ColumnSchema,
): ((value: string, props: CellEditorProps) => unknown) | undefined {
  return presetRuntime(column)?.valueCodec.parse;
}

export function lookupCapabilities(
  preset: ColumnPreset,
): LookupCapabilities | undefined {
  if ("lookup" in preset) return preset.lookup;
  return undefined;
}
