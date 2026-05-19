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
      style={{
        display: "grid",
        gridTemplateColumns: action ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        width: "100%",
      }}
    >
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {children}
      </span>
      {action ? <span>{action(props)}</span> : null}
    </span>
  );
}
