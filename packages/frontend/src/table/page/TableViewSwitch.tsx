import { MonitorSmartphone, PanelsTopLeft, Table2 } from "lucide-react";
import { cn } from "@sapporta/ui";
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
  return (
    <div
      className="inline-flex h-sap-ctl items-center rounded-[6px] border border-sap-border bg-sap-surface p-0.5"
      role="group"
      aria-label="Table view"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              "inline-flex h-[24px] items-center gap-1.5 rounded-[4px] px-2 text-sap-emph font-[650] text-sap-soft",
              active && "bg-sap-row-hover text-sap-fg",
            )}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
