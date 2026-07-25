import {
  DATE_RANGE_SELECT_KEYS,
  type DateRangeSelectKey,
  type DateRangeState,
} from "@sapporta/shared";
import {
  customBoundString,
  selectKeyFromState,
  stateFromSelectKey,
  updateCustomBound,
} from "../params/daterange-picker";
import { Input } from "@sapporta/ui/input";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import { Check, ChevronDown } from "lucide-react";

const SELECT_LABELS: Record<DateRangeSelectKey, string> = {
  all_time: "All time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "1y": "Last year",
  mtd: "Month to date",
  ytd: "Year to date",
  custom: "Custom range...",
};

interface DateRangeOption {
  label: string;
  value: DateRangeSelectKey;
}

const DATE_RANGE_OPTIONS: DateRangeOption[] = DATE_RANGE_SELECT_KEYS.map(
  (value) => ({ label: SELECT_LABELS[value], value }),
);

export interface DateRangeFieldProps {
  label: string;
  required?: boolean;
  value: DateRangeState;
  onChange: (state: DateRangeState) => void;
  error?: string | null;
}

export function DateRangeField({
  label,
  required = false,
  value,
  onChange,
  error,
}: DateRangeFieldProps) {
  const selectKey = selectKeyFromState(value);
  const selectedOption =
    DATE_RANGE_OPTIONS.find((option) => option.value === selectKey) ?? null;

  const handleSelect = (key: DateRangeSelectKey | null) => {
    if (key === null) return;
    onChange(stateFromSelectKey(key, value));
  };

  const handleBoundChange = (side: "start" | "end", dateStr: string) => {
    onChange(updateCustomBound(value, side, dateStr));
  };

  return (
    <label className="flex items-center gap-2 text-sap-data">
      <span className="text-sap-subtle">
        {label.toLowerCase()}
        {required && <span className="text-sap-negative ml-0.5">*</span>}
        {":"}
      </span>

      <Combobox.Root<DateRangeOption>
        items={DATE_RANGE_OPTIONS}
        value={selectedOption}
        onValueChange={(option) => {
          if (option !== null) handleSelect(option.value);
        }}
        itemToStringLabel={(option) => option.label}
        itemToStringValue={(option) => option.value}
        isItemEqualToValue={(option, selected) =>
          option.value === selected.value
        }
      >
        <Combobox.InputGroup
          className={cn(
            comboboxClassNames.inputGroup,
            "h-sap-ctl w-[150px] rounded-[5px] text-sap-emph",
          )}
        >
          <Combobox.Input
            aria-label={`Search ${label.toLowerCase()}`}
            aria-invalid={error ? true : undefined}
            className={comboboxClassNames.input}
          />
          <Combobox.Trigger
            aria-label={`Open ${label.toLowerCase()} choices`}
            className={cn(comboboxClassNames.action, "me-1")}
          >
            <ChevronDown aria-hidden />
          </Combobox.Trigger>
        </Combobox.InputGroup>
        <Combobox.Portal>
          <Combobox.Positioner
            align="start"
            sideOffset={4}
            className={comboboxClassNames.positioner}
          >
            <Combobox.Popup className={comboboxClassNames.popup}>
              <Combobox.Empty className={comboboxClassNames.empty}>
                No matching ranges.
              </Combobox.Empty>
              <Combobox.List className={comboboxClassNames.list}>
                {(option: DateRangeOption) => (
                  <Combobox.Item
                    key={option.value}
                    value={option}
                    className={comboboxClassNames.item}
                  >
                    {option.label}
                    <Combobox.ItemIndicator
                      className={comboboxClassNames.itemIndicator}
                    >
                      <Check aria-hidden />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      {value.type === "custom" && (
        <>
          <Input
            type="date"
            value={customBoundString(value, "start")}
            onChange={(e) => handleBoundChange("start", e.target.value)}
            aria-label="Custom range start"
            aria-invalid={error ? true : undefined}
            className="h-sap-ctl w-[140px] text-sap-emph rounded-[5px] mono"
          />
          <span className="text-sap-subtle">→</span>
          <Input
            type="date"
            value={customBoundString(value, "end")}
            onChange={(e) => handleBoundChange("end", e.target.value)}
            aria-label="Custom range end"
            aria-invalid={error ? true : undefined}
            className="h-sap-ctl w-[140px] text-sap-emph rounded-[5px] mono"
          />
        </>
      )}

      {error ? <span className="text-sap-negative">{error}</span> : null}
    </label>
  );
}
