import { useMemo, useState, type ComponentType, type ReactNode } from "react";
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
import { isTableRowData, type TableRowData } from "./row-data";
import { RowLabel, rowOfEntry } from "./row-display";
import { LookupPickerItemContent } from "./lookup-picker-item";
import { TreeLookupPicker } from "./TreeLookupPicker";

const DEFAULT_SEARCH_LIMIT = 50;

export type LookupPickerItemProps<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = {
  entry: LookupEntry<TValue, TMeta> & { meta: TMeta };
  /** What the option draws without this component: for a table's lookup, the
   *  row through the table's label slot; otherwise the label. Return it, or
   *  wrap it, to keep the table's caption. */
  defaultContent: ReactNode;
};

/** Choose table-like fields or a React component for each dropdown item. */
export type LookupPickerItemDisplay<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = {
  /** Fields rendered by this item and therefore included in lookup search.
   *  The options' `entry.meta` holds every visible column either way. */
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
  /** Draws each option. The chosen value's caption keeps the table's label
   *  slot. */
  itemDisplay?: LookupPickerItemDisplay<TValue, TMeta>;
  /** Where a table's lookup draws the chosen row's caption: `"inline"` inside
   *  the field, at its end; `"below"` on a line of its own under the field,
   *  at full width. The line under the field is kept even while it is empty,
   *  so picking a value never moves what follows. A tree picker draws no
   *  caption: the chosen row's parent path sits before its name. */
  selectedCaption?: "inline" | "below";
  /**
   * For a lookup of a table that declares `meta.tree`: `true` (the default)
   * draws the table as an indented tree, lists a search's matches with their
   * parent paths, and shows the chosen row's parent path before its name.
   * `false` draws the flat search list of any other table.
   */
  tree?: boolean;
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
  selectedCaption = "inline",
  tree = true,
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
  // table's label slot. `itemDisplay` draws options over it. A tree table's
  // row data draws a tree picker.
  const rowData = isTableRowData(lookup) ? lookup : undefined;
  const tableTree = tree ? rowData?.schema()?.tree : undefined;
  if (rowData && tableTree) {
    return (
      <TreeLookupPicker<TValue, TMeta>
        data={rowData}
        tableTree={tableTree}
        value={value}
        onChange={onChange}
        itemDisplay={itemDisplay}
        placeholder={placeholder}
        disabled={disabled}
        allowClear={allowClear}
        searchLimit={searchLimit}
        id={id}
        className={className}
        ariaInvalid={ariaInvalid}
        ariaDescribedBy={ariaDescribedBy}
      />
    );
  }
  return (
    <FlatLookupPicker<TValue, TMeta>
      lookup={lookup}
      rowData={rowData}
      value={value}
      onChange={onChange}
      itemDisplay={itemDisplay}
      selectedCaption={selectedCaption}
      placeholder={placeholder}
      disabled={disabled}
      allowClear={allowClear}
      searchLimit={searchLimit}
      id={id}
      className={className}
      ariaInvalid={ariaInvalid}
      ariaDescribedBy={ariaDescribedBy}
    />
  );
}

function FlatLookupPicker<TValue extends LookupValue, TMeta>({
  lookup,
  rowData,
  value,
  onChange,
  itemDisplay,
  selectedCaption,
  placeholder,
  disabled,
  allowClear,
  searchLimit,
  id,
  className,
  ariaInvalid,
  ariaDescribedBy,
}: Omit<LookupPickerProps<TValue, TMeta>, "tree"> & {
  rowData: TableRowData | undefined;
  searchLimit: number;
}) {
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

  const selectedLabel =
    rowData && selectedEntry ? (
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
    ) : null;
  const inputGroupClassName =
    rowData && selectedCaption === "below"
      ? comboboxClassNames.inputGroup
      : cn(comboboxClassNames.inputGroup, className);

  const picker = (
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
      <Combobox.InputGroup className={inputGroupClassName}>
        <Combobox.Input
          id={id}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          placeholder={placeholder}
          className={comboboxClassNames.input}
        />
        {selectedCaption === "inline" && selectedLabel && searchText === "" && (
          <span
            className="pointer-events-none flex h-full max-w-[45%] shrink-0 items-center overflow-hidden whitespace-nowrap pe-1 text-sap-meta text-sap-muted"
            data-lookup-selected-adornment=""
          >
            {selectedLabel}
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
                  <LookupPickerItemContent
                    entry={entry}
                    itemDisplay={itemDisplay}
                    defaultContent={
                      rowData ? (
                        <RowOption
                          data={rowData}
                          entry={entry}
                          selected={
                            value != null &&
                            lookupValueEquals(entry.value, value)
                          }
                        />
                      ) : (
                        entry.label
                      )
                    }
                  />
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

  if (!rowData || selectedCaption !== "below") return picker;
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {picker}
      <div
        className="flex h-4 min-w-0 items-center overflow-hidden whitespace-nowrap px-3 text-sap-meta text-sap-muted"
        data-lookup-selected-caption=""
      >
        {selectedLabel}
      </div>
    </div>
  );
}

function RowOption({
  data,
  entry,
  selected,
}: {
  data: TableRowData;
  entry: LookupEntry;
  selected: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1">
      <RowLabel
        data={data}
        id={entry.value}
        label={entry.label}
        row={rowOfEntry(entry)}
        context={{
          as: "reference",
          surface: "option",
          density: "regular",
          hierarchyShown: false,
          selected,
        }}
      />
    </span>
  );
}
