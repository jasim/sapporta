import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import {
  lookupValueEquals,
  lookupValueKey,
  type LookupCapabilities,
  type LookupEntry,
  type LookupValue,
} from "@sapporta/grid/lookup";
import { useLookupOptions } from "@sapporta/grid/lookup/react";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
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
  const [searchText, setSearchText] = useState("");
  const selectedValues = useMemo(() => (value == null ? [] : [value]), [value]);
  const entries = useLookupOptions({
    valueLookup: lookup.valueLookup,
    searchLookup: lookup.searchLookup,
    selectedValues,
    searchText,
    limit: searchLimit,
  });
  const selectedEntry = useMemo(
    () =>
      value == null
        ? null
        : (entries.find((entry) => lookupValueEquals(entry.value, value)) ??
          null),
    [entries, value],
  );

  return (
    <Combobox.Root
      items={entries}
      value={selectedEntry}
      onValueChange={(pickedEntry) => {
        setSearchText("");
        onChange((pickedEntry?.value ?? null) as TValue | null);
      }}
      onInputValueChange={(nextSearchText, { reason }) => {
        setSearchText(reason === "input-change" ? nextSearchText : "");
      }}
      isItemEqualToValue={(entry, selected) =>
        lookupValueEquals(entry.value, selected.value)
      }
      filter={null}
      disabled={disabled}
    >
      <Combobox.InputGroup
        className={cn(comboboxClassNames.inputGroup, className)}
      >
        <Combobox.Input
          id={id}
          placeholder={placeholder}
          className={comboboxClassNames.input}
        />
        {allowClear && (
          <Combobox.Clear
            aria-label="Clear selection"
            className={comboboxClassNames.action}
          >
            <X aria-hidden />
          </Combobox.Clear>
        )}
        <Combobox.Trigger
          aria-label="Open popup"
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
              No results.
            </Combobox.Empty>
            <Combobox.List className={comboboxClassNames.list}>
              {(entry: LookupEntry) => (
                <Combobox.Item
                  key={lookupValueKey(entry.value)}
                  value={entry}
                  disabled={entry.disabled}
                  className={comboboxClassNames.item}
                >
                  {entry.label}
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
  );
}
