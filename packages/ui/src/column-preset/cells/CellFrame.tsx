import type { ReactNode } from "react";
import type { CellRenderProps } from "../../grid/types/schema";

export function CellFrame({
  children,
  action,
  ...props
}: {
  children: ReactNode;
  action?: (props: CellRenderProps) => ReactNode;
} & CellRenderProps) {
  return (
    <span data-grid-part="cell-frame" data-with-action={String(action != null)}>
      <span data-grid-part="cell-frame-content">{children}</span>
      {action ? (
        <span
          data-grid-part="cell-frame-actions"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <span data-grid-part="cell-frame-action-inner">{action(props)}</span>
        </span>
      ) : null}
    </span>
  );
}
