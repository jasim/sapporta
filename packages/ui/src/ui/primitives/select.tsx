import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../utils/cn";

function Select<Value extends string = string>({
  ...props
}: SelectProps<Value>) {
  return <SelectPrimitive.Root<Value, false> {...props} />;
}
Select.displayName = "Select";

const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(({ className, children, render, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    render={render}
    className={cn(
      "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon
      render={<ChevronDown className="h-4 w-4 opacity-50" />}
    />
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Popup>,
  SelectContentProps
>(
  (
    {
      className,
      children,
      position = "popper",
      align = "start",
      alignOffset,
      alignItemWithTrigger,
      side,
      sideOffset = 4,
      ...props
    },
    ref,
  ) => {
    const useItemAligned = alignItemWithTrigger ?? position === "item-aligned";

    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          align={align}
          alignItemWithTrigger={useItemAligned}
          alignOffset={alignOffset}
          side={side}
          sideOffset={sideOffset}
        >
          <SelectPrimitive.Popup
            ref={ref}
            className={cn(
              "relative z-[var(--sap-z-popover)] max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-none transition-[opacity,transform] data-starting-style:opacity-0 data-ending-style:opacity-0 data-starting-style:scale-95 data-ending-style:scale-95 data-[side=bottom]:data-starting-style:-translate-y-1 data-[side=bottom]:data-ending-style:-translate-y-1 data-[side=left]:data-starting-style:translate-x-1 data-[side=left]:data-ending-style:translate-x-1 data-[side=right]:data-starting-style:-translate-x-1 data-[side=right]:data-ending-style:-translate-x-1 data-[side=top]:data-starting-style:translate-y-1 data-[side=top]:data-ending-style:translate-y-1",
              !useItemAligned &&
                "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
              className,
            )}
            {...props}
          >
            <SelectPrimitive.List
              className={cn(
                "p-1",
                !useItemAligned &&
                  "h-[var(--anchor-height)] w-full min-w-[var(--anchor-width)]",
              )}
            >
              {children}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    );
  },
);
SelectContent.displayName = "SelectContent";

const SelectItem = React.forwardRef<HTMLElement, SelectItemProps>(
  ({ className, children, render, ...props }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      render={render}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center" />
        }
      >
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = "SelectItem";

type SelectBaseProps<Value extends string = string> =
  SelectPrimitive.Root.Props<Value, false>;

type SelectProps<Value extends string = string> = SelectBaseProps<Value>;

type SelectTriggerProps = SelectPrimitive.Trigger.Props;

interface SelectContentProps
  extends
    SelectPrimitive.Popup.Props,
    Pick<
      SelectPrimitive.Positioner.Props,
      "align" | "alignItemWithTrigger" | "alignOffset" | "side" | "sideOffset"
    > {
  position?: "popper" | "item-aligned";
}

interface SelectItemProps extends Omit<
  SelectPrimitive.Item.Props,
  "className"
> {
  className?: string;
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
};
