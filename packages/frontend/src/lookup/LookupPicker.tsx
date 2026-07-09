import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import {
  isLookupValue,
  lookupValueKey,
  type LookupEntry,
} from "@sapporta/grid/lookup";
import { useLookupOptions } from "@sapporta/grid/lookup/react";
import { Button } from "@sapporta/ui/button";
import { ComboboxList } from "@sapporta/ui/combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";
import { cn } from "@sapporta/ui/cn";

const DEFAULT_SEARCH_LIMIT = 50;

export type LookupPickerProps<TValue extends LookupValue = LookupValue> = {
  lookup: LookupCapabilities;
  value: TValue | null;
  onChange: (value: TValue | null) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  searchLimit?: number;
  id?: string;
  className?: string;
};

export function LookupPicker<TValue extends LookupValue = LookupValue>({
  lookup,
  value,
  onChange,
  placeholder = "Select...",
  disabled,
  allowClear = true,
  searchLimit = DEFAULT_SEARCH_LIMIT,
  id,
  className,
}: LookupPickerProps<TValue>) {
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const selectedValues = useMemo(() => (value == null ? [] : [value]), [value]);
  const entries = useLookupOptions({
    valueLookup: lookup.valueLookup,
    searchLookup: lookup.searchLookup,
    selectedValues,
    searchText,
    limit: searchLimit,
  });
  const options = useMemo(
    () => entries.map((entry) => ({ id: entry.value, label: entry.label })),
    [entries],
  );
  const selectedLabel = selectedLabelForValue(entries, value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn("justify-between font-normal", className)}
          />
        }
      >
        <span className={selectedLabel ? "" : "text-sap-muted"}>
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        className="w-[--anchor-width] p-0"
        align="start"
        sideOffset={4}
      >
        <ComboboxList
          value={value}
          options={options}
          onPick={(pickedValue) => {
            onChange(pickedValue as TValue | null);
            setOpen(false);
          }}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          shouldFilter={false}
          allowClear={allowClear}
        />
      </PopoverContent>
    </Popover>
  );
}

function selectedLabelForValue(
  entries: readonly LookupEntry[],
  value: LookupValue | null,
): string | null {
  if (!isLookupValue(value)) return null;
  const key = lookupValueKey(value);
  return (
    entries.find((entry) => lookupValueKey(entry.value) === key)?.label ??
    String(value)
  );
}
