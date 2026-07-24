import type { ComponentType, ReactNode } from "react";
import type {
  CellEditBehavior,
  CellEditGesture,
  CellEditorProps,
  CellRenderProps,
} from "../grid/types/schema";
import type { ColumnAlign, ColumnPresetKind, ColumnWidth } from "./types";
import type { ColumnPreset } from "./preset";
import type { ColumnPresetRuntime } from "./runtime";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercentage,
  formatText,
} from "./format";
import { parseBoolean, parseDate, parseNumber, parseText } from "./parse";
import { TextEditor } from "./editors/TextEditor";
import { NumericEditor } from "./editors/NumericEditor";
import { DateEditor } from "./editors/DateEditor";
import { BooleanEditor } from "./editors/BooleanEditor";
import { SelectEditor } from "./editors/SelectEditor";
import { LookupValueEditor } from "./editors/LookupValueEditor";
import { renderWithPresetRuntime } from "./render";

export type KindDefaults = {
  align: ColumnAlign;
  width: ColumnWidth;
  edit?: (preset: ColumnPreset) => CellEditBehavior;
  sortable: boolean;
  format: (value: unknown) => string;
  parse?: (value: string, props: CellEditorProps) => unknown;
  compare: (a: unknown, b: unknown) => number;
  renderer: (
    column: ColumnPresetRuntime<unknown>,
  ) => (props: CellRenderProps) => ReactNode;
  editor?: (preset: ColumnPreset) => ComponentType<CellEditorProps>;
};

const textCompare = (a: unknown, b: unknown) =>
  formatText(a).localeCompare(formatText(b));

const numberCompare = (a: unknown, b: unknown) => {
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return textCompare(a, b);
};

export function defaultsFor(kind: ColumnPresetKind): KindDefaults {
  switch (kind) {
    case "identifier":
      return base({ align: "left", width: "compact", edit: undefined });
    case "number":
      return base({
        align: "right",
        width: "numeric",
        format: formatNumber,
        parse: parseNumber,
        compare: numberCompare,
        editor: () => NumericEditor,
      });
    case "currency":
      return base({
        align: "right",
        width: "numeric",
        format: formatCurrency,
        parse: parseNumber,
        compare: numberCompare,
        editor: () => NumericEditor,
      });
    case "percentage":
      return base({
        align: "right",
        width: "numeric",
        format: formatPercentage,
        parse: parseNumber,
        compare: numberCompare,
        editor: () => NumericEditor,
      });
    case "date":
      return base({
        align: "left",
        width: "date",
        format: formatDate,
        parse: parseDate,
        editor: () => DateEditor,
      });
    case "boolean":
      return base({
        align: "center",
        width: "compact",
        parse: parseBoolean,
        editor: () => BooleanEditor,
      });
    case "select":
      return base({
        align: "left",
        width: "enum",
        editor: () => SelectEditor,
      });
    case "foreignKey":
    case "lookupValue":
      return base({
        align: "left",
        width: "foreignKey",
        editor: () => LookupValueEditor,
      });
    case "text":
      return base({});
    default:
      return base({ width: "content" });
  }
}

function base(overrides: Partial<KindDefaults>): KindDefaults {
  return {
    align: "left",
    width: "fill",
    sortable: true,
    edit: (preset) => ({
      editor: (overrides.editor ?? (() => TextEditor))(preset),
      startsOn: DEFAULT_PRESET_EDIT_GESTURES,
    }),
    format: formatText,
    parse: parseText,
    compare: textCompare,
    renderer: renderWithPresetRuntime,
    editor: () => TextEditor,
    ...overrides,
  };
}

export const DEFAULT_PRESET_EDIT_GESTURES: readonly CellEditGesture[] = [
  "enter",
  "type",
  "doubleClick",
];
