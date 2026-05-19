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
    <span
      className={
        action
          ? "grid-cell-frame grid-cell-frame--with-action"
          : "grid-cell-frame"
      }
    >
      <span className="grid-cell-frame__content">{children}</span>
      {action ? (
        <span
          className="grid-cell-frame__actions"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <span className="grid-cell-frame__action-inner">{action(props)}</span>
        </span>
      ) : null}
    </span>
  );
}
