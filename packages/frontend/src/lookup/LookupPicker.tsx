import { useMemo, useState, type ComponentType } from "react";
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
import type { Row } from "@sapporta/shared/contracts";
import { isTableRowData } from "./row-data";
import { RowLabel } from "./row-display";

const DEFAULT_SEARCH_LIMIT = 50;

export type LookupPickerItemProps<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = {
  entry: LookupEntry<TValue, TMeta> & { meta: TMeta };
};

/** Choose table-like fields or a React component for each dropdown item. */
export type LookupPickerItemDisplay<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = {
  /** Fields rendered by this item and therefore included in lookup search. */
  fields: readonly Extract<keyof TMeta, string>[];
  component?: ComponentType<LookupPickerItemProps<TValue, TMeta>>;
};

export type LookupPickerProps<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = {
  lookup: LookupCapabilities<TValue, TMeta>;
  value: TValue | null;
  onChange: (value: TValue | null) => void;
  itemDisplay?: LookupPickerItemDisplay<TValue, TMeta>;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  searchLimit?: number;
  id?: string;
  className?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
};

export function LookupPicker<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
>({
  lookup,
  value,
  onChange,
  itemDisplay,
  placeholder = "Select...",
  disabled,
  allowClear = true,
  searchLimit = DEFAULT_SEARCH_LIMIT,
  id,
  className,
  ariaInvalid,
  ariaDescribedBy,
}: LookupPickerProps<TValue, TMeta>) {
  // A table's row data draws options and the selected value with the
  // table's label slot; `itemDisplay` stays the most specific choice.
  const rowData =
    itemDisplay === undefined && isTableRowData(lookup) ? lookup : undefined;
  const [searchText, setSearchText] = useState("");
  const selectedValues = useMemo(() => (value == null ? [] : [value]), [value]);
  const entries = useLookupOptions({
    valueLookup: lookup.valueLookup,
    searchLookup: lookup.searchLookup,
    selectedValues,
    searchText,
    limit: searchLimit,
    fields: itemDisplay?.fields,
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
      itemToStringValue={(entry) => entry.label}
      filter={null}
      disabled={disabled}
    >
      <Combobox.InputGroup
        className={cn(comboboxClassNames.inputGroup, className)}
      >
        <Combobox.Input
          id={id}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          placeholder={placeholder}
          className={comboboxClassNames.input}
        />
        {rowData && selectedEntry && searchText === "" && (
          <span
            className="pointer-events-none flex h-full max-w-[45%] shrink-0 items-center overflow-hidden whitespace-nowrap pe-1 text-sap-meta text-sap-muted"
            data-lookup-selected-adornment=""
          >
            <RowLabel
              data={rowData}
              id={selectedEntry.value}
              label={selectedEntry.label}
              row={rowOfEntry(selectedEntry)}
              context={{
                as: "reference",
                surface: "selected",
                density: "regular",
                hierarchyShown: false,
              }}
            />
          </span>
        )}
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
              {(entry: LookupEntry<TValue, TMeta>) => (
                <Combobox.Item
                  key={lookupValueKey(entry.value)}
                  value={entry}
                  disabled={entry.disabled}
                  className={comboboxClassNames.item}
                >
                  {rowData ? (
                    <span className="flex min-w-0 flex-1">
                      <RowLabel
                        data={rowData}
                        id={entry.value}
                        label={entry.label}
                        row={rowOfEntry(entry)}
                        context={{
                          as: "reference",
                          surface: "option",
                          density: "regular",
                          hierarchyShown: false,
                          selected:
                            value != null &&
                            lookupValueEquals(entry.value, value),
                        }}
                      />
                    </span>
                  ) : (
                    <LookupPickerItemContent
                      entry={entry}
                      itemDisplay={itemDisplay}
                    />
                  )}
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

function LookupPickerItemContent<TValue extends LookupValue, TMeta>({
  entry,
  itemDisplay,
}: {
  entry: LookupEntry<TValue, TMeta>;
  itemDisplay: LookupPickerItemDisplay<TValue, TMeta> | undefined;
}) {
  if (itemDisplay === undefined || !hasLookupEntryMeta(entry)) {
    return entry.label;
  }

  if (itemDisplay.component !== undefined) {
    const ItemComponent = itemDisplay.component;
    return <ItemComponent entry={entry} />;
  }

  if (itemDisplay.fields.length === 0 || !isObject(entry.meta)) {
    return entry.label;
  }
  const meta = entry.meta;

  return (
    <span
      className="grid min-w-0 flex-1 items-center"
      style={{
        gridTemplateColumns: `repeat(${itemDisplay.fields.length}, minmax(0, 1fr))`,
      }}
    >
      {itemDisplay.fields.map((field, index) => (
        <span key={`${field}:${index}`} className="flex min-w-0 items-center">
          <span className="min-w-0 flex-1 truncate">
            {formatLookupFieldValue(Reflect.get(meta, field))}
          </span>
          {index < itemDisplay.fields.length - 1 && (
            <span
              aria-hidden="true"
              className="shrink-0 px-2 text-muted-foreground"
            >
              |
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

function rowOfEntry(entry: LookupEntry): Readonly<Row> | undefined {
  return isObject(entry.meta) ? (entry.meta as Readonly<Row>) : undefined;
}

function hasLookupEntryMeta<TValue extends LookupValue, TMeta>(
  entry: LookupEntry<TValue, TMeta>,
): entry is LookupEntry<TValue, TMeta> & { meta: TMeta } {
  return entry.meta !== undefined;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function formatLookupFieldValue(value: unknown): string {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "";
}
