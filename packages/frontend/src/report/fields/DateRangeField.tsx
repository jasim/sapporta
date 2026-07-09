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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sapporta/ui/select";

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

      <Select
        items={DATE_RANGE_SELECT_KEYS.map((key) => ({
          label: SELECT_LABELS[key],
          value: key,
        }))}
        value={selectKey}
        onValueChange={handleSelect}
      >
        <SelectTrigger
          aria-invalid={error ? true : undefined}
          className="h-sap-ctl w-[150px] text-sap-emph rounded-[5px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_RANGE_SELECT_KEYS.map((k) => (
            <SelectItem key={k} value={k}>
              {SELECT_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
