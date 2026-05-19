import type { CSSProperties } from "react";
import type { CellRenderProps } from "../../grid/types/schema";
import type { ColumnPreset } from "../preset";
import type { ColumnPresetCellRenderRuntime } from "../runtime";

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
  const className =
    preset.kind === "identifier"
      ? "block truncate text-sap-muted"
      : "block truncate";
  const style: CSSProperties = textMode
    ? {
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 4,
        overflow: "hidden",
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
      }
    : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <span className={className} style={style}>
      {value}
    </span>
  );
}
