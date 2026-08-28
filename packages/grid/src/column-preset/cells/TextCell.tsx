import type { CellRenderProps } from "../../core/types/schema";
import { cn } from "@sapporta/ui";
import type { ColumnPreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";
import styles from "../sapporta-preset.module.css";

export type PresetCellProps<TValue = string> = Omit<
  CellRenderProps,
  "value"
> & {
  value: TValue;
  runtime: ColumnPresetCellRenderRuntime;
  preset?: ColumnPreset;
};

/**
 * Class names the built-in text cells use, for columns that render their own.
 *
 * A `renderCell` override that wraps `defaultContent` keeps the built-in
 * cell's truncation and clamping. One that builds the cell body from scratch
 * replaces them; apply these to keep such a cell lined up with the columns
 * beside it.
 */
export const presetCellClassNames = {
  text: styles.textCell,
  identifier: styles.identifierTextCell,
  multiLine: styles.multiLineTextCell,
} as const;

function textCellClassName(preset: ColumnPreset): string {
  const textMode = "text" in preset ? preset.text.display : undefined;
  return cn(
    preset.kind === "identifier"
      ? presetCellClassNames.identifier
      : presetCellClassNames.text,
    textMode && presetCellClassNames.multiLine,
  );
}

export function TextCell({
  value,
  runtime,
  preset = runtime.preset,
}: PresetCellProps<string>) {
  return <span className={textCellClassName(preset)}>{value}</span>;
}
