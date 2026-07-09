import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "../utils/cn";

const Checkbox = React.forwardRef<HTMLElement, CheckboxProps>(
  ({ className, render, type = "button", ...props }, ref) => {
    return (
      <CheckboxPrimitive.Root
        ref={ref}
        nativeButton
        render={render ?? <button type={type} />}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-disabled:cursor-not-allowed data-disabled:opacity-50 data-checked:bg-primary data-indeterminate:bg-primary data-checked:text-primary-foreground data-indeterminate:text-primary-foreground",
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator
          className={cn("flex items-center justify-center text-current")}
        >
          <Check className="h-4 w-4" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
  },
);
Checkbox.displayName = "Checkbox";

interface CheckboxProps extends Omit<
  CheckboxPrimitive.Root.Props,
  "className" | "render"
> {
  className?: string;
  render?: CheckboxPrimitive.Root.Props["render"];
  type?: React.ButtonHTMLAttributes<HTMLButtonElement>["type"];
}

export { Checkbox };
