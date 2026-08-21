import type { ReactNode } from "react";
import type { CellRenderActivation } from "../../types/schema";

export function CellActivationButton({
  activation,
  gridPart,
  children,
}: {
  activation: CellRenderActivation;
  gridPart: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-grid-part={gridPart}
      aria-label={activation.label}
      title={activation.label}
      disabled={activation.availability.kind === "disabled"}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        activation.run();
      }}
    >
      {children}
    </button>
  );
}
