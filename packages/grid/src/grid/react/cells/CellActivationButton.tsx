import type { ReactNode } from "react";
import type { CellRenderActivation } from "../../types/schema";

export function CellActivationButton({
  activation,
  children,
}: {
  activation: CellRenderActivation;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
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
