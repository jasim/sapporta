import type { CellRenderProps } from "../../core/types/schema";
import type { CurrencyPreset, NumberPreset, PercentagePreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";

export function NumericCell({
  value,
  text,
  preset,
}: Omit<CellRenderProps, "value"> & {
  value: number | null;
  text: string;
  runtime: ColumnPresetCellRenderRuntime;
  preset: NumberPreset | CurrencyPreset | PercentagePreset;
}) {
  const display =
    preset.kind === "number"
      ? preset.number
      : preset.kind === "currency"
        ? preset.currency
        : preset.percentage;
  const isEmpty = value === null || value === 0;
  const base = "mono text-sap-data tabular-nums block w-full text-right";

  if (text === "·") {
    return <span className={`${base} text-sap-subtle`}>{text}</span>;
  }

  let toneClass: string;
  if (isEmpty) {
    toneClass = base;
  } else if (display.strong) {
    toneClass = `${base} font-medium text-sap-fg`;
  } else if (display.colorRule === "positive") {
    toneClass = `${base} font-medium text-sap-positive`;
  } else if (display.colorRule === "negative") {
    toneClass = `${base} font-medium text-sap-negative`;
  } else if (display.colorRule === "signed") {
    toneClass =
      value > 0
        ? `${base} font-medium text-sap-positive`
        : value < 0
          ? `${base} font-medium text-sap-negative`
          : base;
  } else {
    toneClass = `${base} font-medium`;
  }

  return <span className={toneClass}>{text}</span>;
}
