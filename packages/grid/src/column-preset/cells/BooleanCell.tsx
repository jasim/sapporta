import { Check, X } from "lucide-react";
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
    <span className="grid w-full place-items-center">
      {value === true ? (
        <Check aria-label="true" className="h-4 w-4 text-sap-fg" />
      ) : (
        <X aria-label="false" className="h-4 w-4 text-sap-subtle" />
      )}
    </span>
  );
}
