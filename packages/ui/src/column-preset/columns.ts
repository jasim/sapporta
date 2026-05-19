import { createElement } from "react";
import type { CellRenderProps, ColumnSchema } from "../grid/types/schema";
import { CellFrame } from "./cells/CellFrame";
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
  const out: ColumnWithPresetRuntime<TMeta> = {
    id: options.id,
    name: options.name,
    compare: runtime.valueCodec.compare,
    renderCell: runtime.cellView.renderCell,
    editCell: runtime.editBehavior.editable
      ? runtime.editBehavior.editor
      : undefined,
    editTriggers: runtime.editBehavior.editable
      ? runtime.editBehavior.editTriggers
      : [],
    meta: options.meta,
  };
  out[GRID_COLUMN_PRESET_RUNTIME] = runtime;
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
      renderCellAction: options.renderCellAction,
    },
    editBehavior: {
      editable: options.editable ?? defaults.editable,
      editor: options.editor ?? defaults.editor?.(columnPreset),
      editTriggers: options.editTriggers ?? defaults.editTriggers,
    },
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
  if (options.renderCell && !options.renderCellAction) {
    return options.renderCell;
  }

  return (props: CellRenderProps) => {
    const runtime = presetRuntime<TMeta>(props.column) ?? fallback();
    const render = options.renderCell
      ? (cellProps: CellRenderProps) => options.renderCell!(cellProps)
      : renderWithPresetRuntime(runtime);

    if (!options.renderCellAction) return render(props);
    if (!options.renderCell) {
      return renderWithPresetRuntime(runtime)(props);
    }

    return createElement(CellFrame, {
      ...props,
      action: options.renderCellAction,
      children: render(props),
    });
  };
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
