import type { CellRenderProps } from "../../grid/types/schema";
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

export function TextCell({
  value,
  runtime,
  preset = runtime.preset,
}: PresetCellProps<string>) {
  const textMode = "text" in preset ? preset.text.display : undefined;
  const className = cn(
    preset.kind === "identifier"
      ? styles.identifierTextCell
      : styles.textCell,
    textMode && styles.multiLineTextCell,
  );

  return <span className={className}>{value}</span>;
}
