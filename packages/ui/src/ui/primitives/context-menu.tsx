import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cn } from "../utils/cn";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuGroup = ContextMenuPrimitive.Group;
const ContextMenuPortal = ContextMenuPrimitive.Portal;
const ContextMenuSub = ContextMenuPrimitive.SubmenuRoot;
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

const ContextMenuTrigger = React.forwardRef<
  HTMLDivElement,
  ContextMenuTriggerProps
>((props, ref) => <ContextMenuPrimitive.Trigger ref={ref} {...props} />);
ContextMenuTrigger.displayName = "ContextMenuTrigger";

const ContextMenuSubTrigger = React.forwardRef<
  HTMLElement,
  ContextMenuSubTriggerProps
>(({ className, inset, render, children, ...props }, ref) => (
  <ContextMenuPrimitive.SubmenuTrigger
    ref={ref}
    render={render}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
  </ContextMenuPrimitive.SubmenuTrigger>
));
ContextMenuSubTrigger.displayName = "ContextMenuSubTrigger";

const ContextMenuSubContent = React.forwardRef<
  HTMLDivElement,
  ContextMenuContentProps
>(({ className, ...props }, ref) => (
  <ContextMenuContent
    ref={ref}
    align="start"
    alignOffset={4}
    side="right"
    sideOffset={0}
    className={cn("w-auto", className)}
    {...props}
  />
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";

const ContextMenuContent = React.forwardRef<
  HTMLDivElement,
  ContextMenuContentProps
>(
  (
    { className, align, alignOffset, side, sideOffset, children, ...props },
    ref,
  ) => (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-[var(--sap-z-popover)] outline-none"
      >
        <ContextMenuPrimitive.Popup
          ref={ref}
          className={cn(
            "z-[var(--sap-z-popover)] min-w-36 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none transition-[opacity,transform] data-starting-style:opacity-0 data-ending-style:opacity-0 data-starting-style:scale-95 data-ending-style:scale-95 data-[side=bottom]:data-starting-style:-translate-y-2 data-[side=bottom]:data-ending-style:-translate-y-2 data-[side=left]:data-starting-style:translate-x-2 data-[side=left]:data-ending-style:translate-x-2 data-[side=right]:data-starting-style:-translate-x-2 data-[side=right]:data-ending-style:-translate-x-2 data-[side=top]:data-starting-style:translate-y-2 data-[side=top]:data-ending-style:translate-y-2",
            className,
          )}
          {...props}
        >
          {children}
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  ),
);
ContextMenuContent.displayName = "ContextMenuContent";

const ContextMenuItem = React.forwardRef<HTMLElement, ContextMenuItemProps>(
  ({ className, inset, render, children, ...props }, ref) => (
    <ContextMenuPrimitive.Item
      ref={ref}
      render={render}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Item>
  ),
);
ContextMenuItem.displayName = "ContextMenuItem";

const ContextMenuSeparator = React.forwardRef<
  HTMLDivElement,
  ContextMenuSeparatorProps
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";

const ContextMenuLabel = React.forwardRef<
  HTMLDivElement,
  ContextMenuLabelProps
>(({ className, inset, render, children, ...props }, ref) => (
  <ContextMenuPrimitive.GroupLabel
    ref={ref}
    render={render}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold text-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
  </ContextMenuPrimitive.GroupLabel>
));
ContextMenuLabel.displayName = "ContextMenuLabel";

type ContextMenuTriggerProps = ContextMenuPrimitive.Trigger.Props;

interface ContextMenuSubTriggerProps
  extends ContextMenuPrimitive.SubmenuTrigger.Props {
  inset?: boolean;
}

interface ContextMenuContentProps
  extends
    ContextMenuPrimitive.Popup.Props,
    Pick<
      ContextMenuPrimitive.Positioner.Props,
      "align" | "alignOffset" | "side" | "sideOffset"
    > {}

interface ContextMenuItemProps extends Omit<
  ContextMenuPrimitive.Item.Props,
  "className"
> {
  className?: string;
  inset?: boolean;
}

type ContextMenuSeparatorProps = ContextMenuPrimitive.Separator.Props;

interface ContextMenuLabelProps extends ContextMenuPrimitive.GroupLabel.Props {
  inset?: boolean;
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
  ContextMenuLabel,
};
