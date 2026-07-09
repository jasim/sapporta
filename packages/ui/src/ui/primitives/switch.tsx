import * as React from "react";
import { Switch as SwitchPrimitives } from "@base-ui/react/switch";
import { cn } from "../utils/cn";

const Switch = React.forwardRef<HTMLElement, SwitchProps>(
  ({ className, render, type = "button", ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:bg-primary data-unchecked:bg-input",
        className,
      )}
      nativeButton
      render={render ?? <button type={type} />}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-checked:translate-x-4 data-unchecked:translate-x-0",
        )}
      />
    </SwitchPrimitives.Root>
  ),
);
Switch.displayName = "Switch";

interface SwitchProps extends Omit<
  SwitchPrimitives.Root.Props,
  "className" | "render"
> {
  className?: string;
  render?: SwitchPrimitives.Root.Props["render"];
  type?: React.ButtonHTMLAttributes<HTMLButtonElement>["type"];
}

export { Switch };
