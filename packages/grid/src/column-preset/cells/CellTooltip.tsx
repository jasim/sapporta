import type { ComponentProps, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@sapporta/ui";
import styles from "../sapporta-preset.module.css";

export type CellTooltipProps = {
  /** Tooltip body. Nothing is shown while this is empty. */
  content: ReactNode;
  /** Class name for the wrapper around the cell body. */
  className?: string;
  /** Milliseconds to hover before the tooltip opens. */
  delay?: number;
  side?: ComponentProps<typeof TooltipContent>["side"];
  children: ReactNode;
};

/**
 * A tooltip sized and placed for a grid cell.
 *
 * Grid cells carry no tooltip by default. To add one to a column, give the
 * column a `renderCell` and wrap `defaultContent` — the cell the column
 * would have rendered on its own, formatting and truncation included:
 *
 *     renderCell: ({ defaultContent, row }) => (
 *       <CellTooltip content={row.description}>{defaultContent}</CellTooltip>
 *     )
 *
 * A cell built from scratch instead of from `defaultContent` supplies its
 * own body; pass `className` (for example `presetCellClassNames.text`) to
 * keep it truncated like the built-in cells.
 *
 * An empty `content` renders the body on its own, so a tooltip can be shown
 * on some rows and left off on others.
 */
export function CellTooltip({
  content,
  className,
  delay = 100,
  side,
  children,
}: CellTooltipProps) {
  // Booleans count as empty because React renders them as nothing, and a
  // conditional such as `row.flagged && <Note />` produces `false`.
  if (
    content === null ||
    content === undefined ||
    content === "" ||
    typeof content === "boolean"
  ) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delay={delay}>
      <Tooltip>
        <TooltipTrigger
          render={<span className={className} />}
          data-grid-part="cell-tooltip-trigger"
        >
          {children}
        </TooltipTrigger>
        <TooltipContent
          data-grid-part="cell-tooltip-content"
          side={side}
          sideOffset={6}
          className={styles.cellTooltipContent}
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
