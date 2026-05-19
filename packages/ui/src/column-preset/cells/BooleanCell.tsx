import { Check, Minus } from "lucide-react";
import type { CellRenderProps } from "../../grid/types/schema";
import type { BooleanPreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";

export function BooleanCell({
  value,
}: Omit<CellRenderProps, "value"> & {
  value: boolean;
  runtime: ColumnPresetCellRenderRuntime;
  preset: BooleanPreset;
}) {
  return (
    <span style={{ display: "grid", placeItems: "center", width: "100%" }}>
      {value === true ? (
        <Check aria-label="true" size={16} />
      ) : (
        <Minus aria-label="false" size={16} opacity={0.35} />
      )}
    </span>
  );
}
