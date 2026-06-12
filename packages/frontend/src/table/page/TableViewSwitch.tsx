import { useState } from "react";
import { Check, MonitorSmartphone, PanelsTopLeft, Table2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@sapporta/ui";
import type { TGridView } from "./TGrid";

const options: readonly {
  value: TGridView;
  label: string;
  icon: typeof MonitorSmartphone;
}[] = [
  { value: "auto", label: "Auto", icon: MonitorSmartphone },
  { value: "tabular", label: "Tabular", icon: Table2 },
  { value: "cards", label: "Cards", icon: PanelsTopLeft },
];

export function TableViewSwitch({
  value,
  onChange,
}: {
  value: TGridView;
  onChange: (view: TGridView) => void;
}) {
  const [open, setOpen] = useState(false);

  function selectView(nextView: TGridView) {
    onChange(nextView);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Open table view options"
        title="View options"
        className="inline-flex h-sap-ctl w-[30px] items-center justify-center rounded-[6px] border border-sap-border bg-sap-surface text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg group-data-[toolbar-band=compact]/table-toolbar:h-11 group-data-[toolbar-band=compact]/table-toolbar:w-11 group-data-[toolbar-band=compact]/table-toolbar:shrink-0"
      >
        <PanelsTopLeft className="h-[12px] w-[12px] group-data-[toolbar-band=compact]/table-toolbar:h-4 group-data-[toolbar-band=compact]/table-toolbar:w-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[220px] border-sap-border bg-sap-surface p-1 text-sap-body"
      >
        <div
          className="px-2 py-1 text-sap-label font-bold uppercase tracking-sap-section text-sap-subtle"
          id="table-view-layout-label"
        >
          Layout
        </div>
        <div role="menu" aria-labelledby="table-view-layout-label">
          {options.map((option) => {
            const Icon = option.icon;
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[5px] px-2 py-[7px] text-left text-sap-data text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg",
                  active && "text-sap-fg",
                )}
                onClick={() => selectView(option.value)}
              >
                <span className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center text-sap-subtle">
                  <Icon className="h-[13px] w-[13px]" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {option.label}
                </span>
                <span className="inline-flex h-[14px] w-[14px] items-center justify-center text-sap-fg">
                  {active && <Check className="h-[13px] w-[13px]" />}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
