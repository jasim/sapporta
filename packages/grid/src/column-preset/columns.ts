import type {
  CellRenderProps,
  ColumnSchema,
  GridColumnCopyBehavior,
  GridCopyColumn,
} from "../grid/types/schema";
import { defaultsFor } from "./defaults";
import { normalizeOptions } from "./lookup";
import {
  GRID_COLUMN_PRESET_RUNTIME,
  kind,
  meta,
  parse,
  preset,
  presetRuntime,
  width,
  type ColumnPreset,
  type ForeignKeyPreset,
  type LookupPreset,
  type SelectPreset,
} from "./preset";
import type { ColumnPresetRuntime } from "./runtime";
import { renderWithPresetRuntime } from "./render";
import { chrome } from "./header/chrome";
import { templateColumns, trackForColumn } from "./width";
import type {
  ColumnPresetKind,
  ColumnPresetOptions,
  LookupColumnOptions,
  NumberColumnOptions,
  SelectColumnOptions,
  TextColumnOptions,
} from "./types";

type ColumnWithPresetRuntime<TMeta = unknown> = ColumnSchema & {
  [GRID_COLUMN_PRESET_RUNTIME]?: ColumnPresetRuntime<TMeta>;
};

export function identifier<TMeta = unknown>(
  options: ColumnPresetOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "identifier" });
}

export function text<TMeta = unknown>(
  options: TextColumnOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "text" });
}

export function number<TMeta = unknown>(
  options: NumberColumnOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "number" });
}

export function currency<TMeta = unknown>(
  options: NumberColumnOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "currency" });
}

export function percentage<TMeta = unknown>(
  options: NumberColumnOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "percentage" });
}

export function date<TMeta = unknown>(
  options: ColumnPresetOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "date" });
}

export function boolean<TMeta = unknown>(
  options: ColumnPresetOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "boolean" });
}

export function select<TMeta = unknown>(
  options: SelectColumnOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "select" });
}

export function lookupValue<TMeta = unknown>(
  options: LookupColumnOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "lookupValue" });
}

export function foreignKey<TMeta = unknown>(
  options: LookupColumnOptions<TMeta>,
): ColumnSchema {
  return column<TMeta>({ ...options, kind: "foreignKey" });
}

export function column<TMeta = unknown>(
  options: ColumnPresetOptions<TMeta>,
): ColumnSchema {
  return constructColumn(options);
}

function constructColumn<TMeta>(
  options: ColumnPresetOptions<TMeta>,
): ColumnSchema {
  const columnPreset = normalizePreset(options);
  const runtime = normalizePresetRuntime(options, columnPreset);
  const copy = options.copy ?? defaultCopyBehavior(columnPreset, runtime);
  const out: ColumnWithPresetRuntime<TMeta> = {
    id: options.id,
    name: options.name,
    compare: runtime.valueCodec.compare,
    renderCell: runtime.cellView.renderCell,
    edit: runtime.edit,
    activation: runtime.activation,
    meta: options.meta,
    ...(copy ? { copy } : {}),
    [GRID_COLUMN_PRESET_RUNTIME]: runtime,
  };
  return out;
}

function normalizePreset<TMeta>(
  options: ColumnPresetOptions<TMeta>,
): ColumnPreset {
  const columnKind = (options.kind ?? "text") as ColumnPresetKind;
  const defaults = defaultsFor(columnKind);
  const base = {
    layout: {
      align: options.align ?? defaults.align,
      width: options.width ?? defaults.width,
    },
  };

  switch (columnKind) {
    case "identifier":
      return { ...base, kind: "identifier" };
    case "number":
      return {
        ...base,
        kind: "number",
        number: numberDisplay(options as NumberColumnOptions<TMeta>),
      };
    case "currency":
      return {
        ...base,
        kind: "currency",
        currency: numberDisplay(options as NumberColumnOptions<TMeta>),
      };
    case "percentage":
      return {
        ...base,
        kind: "percentage",
        percentage: numberDisplay(options as NumberColumnOptions<TMeta>),
      };
    case "date":
      return { ...base, kind: "date" };
    case "boolean":
      return { ...base, kind: "boolean" };
    case "select":
      return {
        ...base,
        kind: "select",
        select: {
          options: normalizeOptions(
            (options as SelectColumnOptions<TMeta>).options ?? [],
          ),
        },
      };
    case "lookupValue":
      return {
        ...base,
        kind: "lookupValue",
        lookup: {
          valueLookup: (options as LookupColumnOptions<TMeta>).valueLookup,
          searchLookup: (options as LookupColumnOptions<TMeta>).searchLookup,
        },
      };
    case "foreignKey":
      return {
        ...base,
        kind: "foreignKey",
        lookup: {
          valueLookup: (options as LookupColumnOptions<TMeta>).valueLookup,
          searchLookup: (options as LookupColumnOptions<TMeta>).searchLookup,
        },
      };
    case "text":
      return {
        ...base,
        kind: "text",
        text: {
          display: (options as TextColumnOptions<TMeta>).display,
        },
      };
    default:
      return {
        ...base,
        kind: columnKind,
      } as ColumnPreset;
  }
}

function normalizePresetRuntime<TMeta>(
  options: ColumnPresetOptions<TMeta>,
  columnPreset: ColumnPreset,
): ColumnPresetRuntime<TMeta> {
  const defaults = defaultsFor(columnPreset.kind);
  let runtime: ColumnPresetRuntime<TMeta>;
  const renderCell = createRenderCell(options, () => runtime);
  const edit = resolvePresetEdit(options, columnPreset);

  runtime = {
    preset: columnPreset,
    meta: options.meta,
    valueCodec: {
      format: options.format ?? defaults.format,
      parse: options.parse ?? defaults.parse,
      compare: options.compare ?? defaults.compare,
    },
    cellView: {
      renderCell,
    },
    edit,
    activation: options.activation,
    headerBehavior: {
      sortable: options.sortable ?? defaults.sortable,
      renderColumnHeader: options.renderColumnHeader,
      renderColumnHeaderMenu: options.renderColumnHeaderMenu,
    },
  };

  return runtime;
}

function createRenderCell<TMeta>(
  options: ColumnPresetOptions<TMeta>,
  fallback: () => ColumnPresetRuntime<TMeta>,
) {
  if (options.renderCell) {
    return options.renderCell;
  }

  return (props: CellRenderProps) => {
    const runtime = presetRuntime<TMeta>(props.column) ?? fallback();
    return renderWithPresetRuntime(runtime)(props);
  };
}

function resolvePresetEdit<TMeta>(
  options: ColumnPresetOptions<TMeta>,
  columnPreset: ColumnPreset,
): ColumnSchema["edit"] {
  const defaults = defaultsFor(columnPreset.kind);
  const option = options.edit ?? "default";
  if (option === "none") return undefined;
  const defaultEdit = defaults.edit?.(columnPreset);
  if (option === "default") return defaultEdit;
  const editor =
    option.editor === undefined || option.editor === "default"
      ? defaultEdit?.editor
      : option.editor;
  if (!editor) return undefined;
  return {
    editor,
    startsOn: option.startsOn ?? defaultEdit?.startsOn ?? [],
  };
}

function defaultCopyBehavior<TMeta>(
  columnPreset: ColumnPreset,
  runtime: ColumnPresetRuntime<TMeta>,
): GridColumnCopyBehavior | undefined {
  if (isSelectCopyPreset(columnPreset)) {
    return ({ column }) => [
      rawCopyColumn(column),
      {
        header: `${column.id}_label`,
        valueAt: (row) =>
          selectLabelForValue(row.columns[column.id], columnPreset, runtime),
      },
    ];
  }

  if (isLookupCopyPreset(columnPreset)) {
    return async ({ column, rows }) => {
      const values = rows.map((row) => row.columns[column.id]);
      await columnPreset.lookup.valueLookup
        .loadMissingEntries(values)
        .catch(() => {});
      return [
        rawCopyColumn(column),
        {
          header: `${column.id}_label`,
          valueAt: (row) => {
            const value = row.columns[column.id];
            return (
              columnPreset.lookup.valueLookup.entryForValue(value)?.label ??
              runtime.valueCodec.format(value)
            );
          },
        },
      ];
    };
  }

  return undefined;
}

function rawCopyColumn(column: ColumnSchema): GridCopyColumn {
  return {
    header: column.id,
    valueAt: (row) => row.columns[column.id],
  };
}

function selectLabelForValue<TMeta>(
  value: unknown,
  columnPreset: SelectPreset,
  runtime: ColumnPresetRuntime<TMeta>,
): string {
  return (
    columnPreset.select.options.find((option) => Object.is(option.value, value))
      ?.label ?? runtime.valueCodec.format(value)
  );
}

function isSelectCopyPreset(preset: ColumnPreset): preset is SelectPreset {
  return preset.kind === "select" && "select" in preset;
}

function isLookupCopyPreset(
  preset: ColumnPreset,
): preset is LookupPreset | ForeignKeyPreset {
  return (
    (preset.kind === "lookupValue" || preset.kind === "foreignKey") &&
    "lookup" in preset
  );
}

function numberDisplay<TMeta>(options: NumberColumnOptions<TMeta>) {
  return {
    colorRule: options.colorRule,
    zeroDisplay: options.zeroDisplay,
    strong: options.strong ?? false,
  };
}

export const columnPreset = {
  identifier,
  text,
  number,
  currency,
  percentage,
  date,
  boolean,
  select,
  lookupValue,
  foreignKey,
  column,
  chrome,
  preset,
  meta,
  kind,
  width,
  parse,
  trackForColumn,
  templateColumns,
};
