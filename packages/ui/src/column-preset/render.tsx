import type { ReactNode } from "react";
import type { CellRenderProps } from "../grid/types/schema";
import type { ColumnPresetRuntime } from "./runtime";
import type {
  BooleanPreset,
  ColumnPreset,
  CurrencyPreset,
  DatePreset,
  ForeignKeyPreset,
  LookupPreset,
  NumberPreset,
  PercentagePreset,
  SelectPreset,
} from "./preset";
import { CellFrame } from "./cells/CellFrame";
import { TextCell } from "./cells/TextCell";
import { NumericCell } from "./cells/NumericCell";
import { DateCell } from "./cells/DateCell";
import { BooleanCell } from "./cells/BooleanCell";
import { SelectCell } from "./cells/SelectCell";
import { LookupValueCell } from "./cells/LookupValueCell";
import type { LookupValue } from "@/lookup/cache/value-lookup";

export function renderWithPresetRuntime<TMeta = unknown>(
  runtime: ColumnPresetRuntime<TMeta>,
): (props: CellRenderProps) => ReactNode {
  return (props) => {
    const content = renderContent(runtime, props);
    if (!runtime.cellView.renderCellAction) return content;
    return (
      <CellFrame {...props} action={runtime.cellView.renderCellAction}>
        {content}
      </CellFrame>
    );
  };
}

function renderContent<TMeta = unknown>(
  runtime: ColumnPresetRuntime<TMeta>,
  props: CellRenderProps,
): ReactNode {
  const columnPreset = runtime.preset;
  if (isNumericPreset(columnPreset)) {
    const numeric = numericCellValue(props.value, runtime, columnPreset);
    return (
      <NumericCell
        {...propsWithValue(props, numeric.value)}
        text={numeric.text}
        runtime={runtime}
        preset={columnPreset}
      />
    );
  }
  if (isDatePreset(columnPreset)) {
    return (
      <DateCell
        {...propsWithValue(props, runtime.valueCodec.format(props.value))}
        runtime={runtime}
        preset={columnPreset}
      />
    );
  }
  if (isBooleanPreset(columnPreset)) {
    return (
      <BooleanCell
        {...propsWithValue(props, props.value === true)}
        runtime={runtime}
        preset={columnPreset}
      />
    );
  }
  if (isSelectPreset(columnPreset)) {
    return (
      <SelectCell
        {...propsWithValue(
          props,
          selectCellLabel(props.value, runtime, columnPreset),
        )}
        runtime={runtime}
        preset={columnPreset}
      />
    );
  }
  if (isLookupPreset(columnPreset)) {
    const lookup = lookupCellValue(props.value);
    return (
      <LookupValueCell
        {...propsWithValue(props, lookup.value)}
        empty={lookup.empty}
        runtime={runtime}
        preset={columnPreset}
        fallbackLabel={runtime.valueCodec.format(props.value)}
        valueLookup={columnPreset.lookup.valueLookup}
      />
    );
  }
  return (
    <TextCell
      {...propsWithValue(props, runtime.valueCodec.format(props.value))}
      runtime={runtime}
      preset={columnPreset}
    />
  );
}

function propsWithValue<TValue>(
  props: CellRenderProps,
  value: TValue,
): Omit<CellRenderProps, "value"> & { value: TValue } {
  return { ...props, value };
}

function numericCellValue<TMeta>(
  rawValue: unknown,
  runtime: ColumnPresetRuntime<TMeta>,
  preset: NumberPreset | CurrencyPreset | PercentagePreset,
): { value: number | null; text: string } {
  const n =
    rawValue === null || rawValue === undefined || rawValue === ""
      ? null
      : typeof rawValue === "number"
        ? rawValue
        : Number(rawValue);
  const value = n !== null && Number.isFinite(n) ? n : null;
  const isEmpty = value === null || value === 0;
  const display =
    preset.kind === "number"
      ? preset.number
      : preset.kind === "currency"
        ? preset.currency
        : preset.percentage;
  const text =
    isEmpty && display.zeroDisplay === "blank"
      ? ""
      : isEmpty && display.zeroDisplay === "dot"
        ? "·"
        : runtime.valueCodec.format(rawValue);
  return { value, text };
}

function selectCellLabel<TMeta>(
  value: unknown,
  runtime: ColumnPresetRuntime<TMeta>,
  preset: SelectPreset,
): string {
  return (
    preset.select.options.find((option) => Object.is(option.value, value))
      ?.label ?? runtime.valueCodec.format(value)
  );
}

function lookupCellValue(value: unknown): {
  value: LookupValue | null;
  empty: boolean;
} {
  if (value == null || value === "") return { value: null, empty: true };
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { value, empty: false };
  }
  return { value: null, empty: false };
}

function isNumericPreset(
  preset: ColumnPreset,
): preset is NumberPreset | CurrencyPreset | PercentagePreset {
  return (
    preset.kind === "number" ||
    preset.kind === "currency" ||
    preset.kind === "percentage"
  );
}

function isDatePreset(preset: ColumnPreset): preset is DatePreset {
  return preset.kind === "date";
}

function isBooleanPreset(preset: ColumnPreset): preset is BooleanPreset {
  return preset.kind === "boolean";
}

function isSelectPreset(preset: ColumnPreset): preset is SelectPreset {
  return preset.kind === "select";
}

function isLookupPreset(
  preset: ColumnPreset,
): preset is LookupPreset | ForeignKeyPreset {
  return preset.kind === "foreignKey" || preset.kind === "lookupValue";
}
