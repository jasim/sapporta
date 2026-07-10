export { Combobox } from "@base-ui/react/combobox";

export const comboboxClassNames = {
  inputGroup:
    "flex h-9 w-full items-center rounded-md border border-input bg-transparent shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring data-disabled:cursor-not-allowed data-disabled:opacity-50",
  input:
    "h-full min-w-0 flex-1 bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
  action:
    "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-4",
  trigger: "[&_svg]:size-4",
  positioner: "isolate z-[var(--sap-z-popover)] outline-none",
  popup:
    "w-[--anchor-width] overflow-hidden rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none transition-[opacity,transform] data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0",
  empty: "py-6 text-center text-sm empty:py-0",
  list: "max-h-[300px] overflow-x-hidden overflow-y-auto p-1",
  item: "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 pr-8 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
  itemIndicator: "absolute right-2 text-sap-muted [&_svg]:size-3.5",
} as const;
