import type { CellRenderProps } from "../../grid/types/schema";
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
  const color =
    value !== null && display.colorRule
      ? display.colorRule === "signed"
        ? value > 0
          ? "var(--color-emerald-700, #047857)"
          : value < 0
            ? "var(--color-rose-700, #be123c)"
            : undefined
        : display.colorRule === "positive"
          ? "var(--color-emerald-700, #047857)"
          : "var(--color-rose-700, #be123c)"
      : undefined;
  return (
    <span
      style={{
        display: "block",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        fontWeight: display.strong ? 600 : undefined,
        color,
      }}
    >
      {text}
    </span>
  );
}
