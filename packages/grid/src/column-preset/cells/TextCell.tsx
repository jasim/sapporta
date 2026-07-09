import type { CellRenderProps } from "../../grid/types/schema";
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@sapporta/ui";
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
    preset.kind === "identifier" ? styles.identifierTextCell : styles.textCell,
    textMode && styles.multiLineTextCell,
  );

  const content = <span className={className}>{value}</span>;
  if (preset.kind !== "text" || value === "") return content;

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger
          render={<span className={className} />}
          data-grid-part="text-cell-tooltip-trigger"
        >
          {content}
        </TooltipTrigger>
        <TooltipContent
          data-grid-part="text-cell-tooltip-content"
          sideOffset={6}
          className={styles.cellTooltipContent}
        >
          {value}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
