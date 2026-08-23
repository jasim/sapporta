import type { CellRenderProps } from "../../core/types/schema";
import type { SelectPreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";
import styles from "../sapporta-preset.module.css";

export function SelectCell({
  value,
}: Omit<CellRenderProps, "value"> & {
  value: string;
  runtime: ColumnPresetCellRenderRuntime;
  preset: SelectPreset;
}) {
  if (value === "") return null;
  return <span className={styles.textCell}>{value}</span>;
}
