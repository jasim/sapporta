import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import {
  lookupValueEquals,
  lookupValueKey,
  type LookupEntry,
  type LookupValue,
} from "@sapporta/grid/lookup";
import {
  useLookupSearchResults,
  useLookupValueEntries,
} from "@sapporta/grid/lookup/react";
import { ApiError } from "@sapporta/shared/error";
import type { LookupTreeRole, TableTree } from "@sapporta/shared/contracts";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import type { TableRowData } from "./row-data";
import { RowLabel, rowOfEntry, useRowComputedRecord } from "./row-display";
import type { LookupPickerProps } from "./LookupPicker";
import { LookupPickerItemContent } from "./lookup-picker-item";

/*
 * The picker of a tree table (`meta.tree`). With nothing typed it draws the
 * table as the server's tree lookup returns it: indented, the rows that
 * cannot be picked greyed and skipped. Typing searches the server and lists
 * the matches flat, each after its parent path. The chosen row's parent path
 * sits before its name in the field. The paths are the table's `tree.path`
 * field, so the picker never builds one.
 */

// One option: a row, how deep it sits (`null` in a search, which is flat),
// and whether it can be picked.
type TreeOption = {
  entry: LookupEntry;
  depth: number | null;
  role: LookupTreeRole;
};

export function TreeLookupPicker<TValue extends LookupValue, TMeta>({
  data,
  tableTree: tree,
  value,
  onChange,
  itemDisplay,
  placeholder,
  disabled,
  allowClear,
  searchLimit,
  id,
  className,
  ariaInvalid,
  ariaDescribedBy,
}: Omit<
  LookupPickerProps<TValue, TMeta>,
  "lookup" | "selectedCaption" | "tree"
> & {
  data: TableRowData;
  tableTree: TableTree;
  searchLimit: number;
}) {
  // What is typed; `null` while the field shows the chosen row's name.
  const [query, setQuery] = useState<string | null>(null);
  const searching = (query ?? "").trim() !== "";

  const treeLookup = data.treeLookup;
  const treeState = useSyncExternalStore(
    (listener) => treeLookup.subscribe(listener),
    () => treeLookup.state(),
  );
  useEffect(() => treeLookup.load(), [treeLookup]);

  const matches = useLookupSearchResults(
    searching ? data.searchLookup : undefined,
    query ?? "",
    searchLimit,
    itemDisplay?.fields,
  );
  const [chosenEntry] = useLookupValueEntries(
    data.valueLookup,
    value == null ? [] : [value],
  );
  const chosen: TreeOption | null =
    value == null
      ? null
      : {
          entry: chosenEntry ?? { value, label: String(value) },
          depth: null,
          role: "choice",
        };

  const options: TreeOption[] = searching
    ? matches.map((entry) => ({ entry, depth: null, role: "choice" }))
    : treeState.entries.map((entry) => ({
        entry,
        depth: entry.depth,
        role: entry.role,
      }));

  return (
    <Combobox.Root<TreeOption>
      items={options}
      value={chosen}
      onValueChange={(picked) => {
        setQuery(null);
        onChange((picked?.entry.value ?? null) as TValue | null);
      }}
      // The input is controlled, so what is typed stays while the tree or
      // the search results are read again.
      inputValue={query ?? chosen?.entry.label ?? ""}
      onInputValueChange={(text, { reason }) =>
        setQuery(reason === "input-change" ? text : null)
      }
      onOpenChange={(open) => {
        if (!open) setQuery(null);
      }}
      isItemEqualToValue={(option, selected) =>
        lookupValueEquals(option.entry.value, selected.entry.value)
      }
      itemToStringLabel={(option) => option.entry.label}
      filter={null}
      disabled={disabled}
    >
      <Combobox.InputGroup
        className={cn(comboboxClassNames.inputGroup, className)}
      >
        {chosen && !searching && tree.path && (
          <ParentPath
            data={data}
            id={chosen.entry.value}
            tree={tree}
            className="max-w-[55%] shrink-0 truncate ps-3"
            data-lookup-selected-path=""
          />
        )}
        <Combobox.Input
          id={id}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
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
          <Combobox.Popup
            className={cn(comboboxClassNames.popup, "transition-none")}
          >
            {!searching && treeState.status === "error" && (
              <div
                className="px-3 py-2 text-sap-body text-sap-muted"
                role="status"
              >
                {treeErrorText(treeState.error)}
              </div>
            )}
            <Combobox.Empty className={comboboxClassNames.empty}>
              {!searching && treeState.status === "error"
                ? null
                : !searching && treeState.status !== "ready"
                  ? "Loading…"
                  : "No results."}
            </Combobox.Empty>
            <Combobox.List className={comboboxClassNames.list}>
              {(option: TreeOption) => (
                <Combobox.Item
                  key={lookupValueKey(option.entry.value)}
                  value={option}
                  disabled={option.role !== "choice"}
                  className={cn(
                    comboboxClassNames.item,
                    // Greyed rather than faded: these rows place the others.
                    "data-disabled:opacity-100",
                    option.role !== "choice" && "text-sap-muted",
                  )}
                  style={
                    option.depth === null
                      ? undefined
                      : {
                          paddingInlineStart: `${0.5 + option.depth * 1.125}rem`,
                        }
                  }
                  data-tree-role={option.role}
                >
                  <LookupPickerItemContent
                    entry={option.entry as LookupEntry<TValue, TMeta>}
                    itemDisplay={itemDisplay}
                    defaultContent={
                      <span className="flex min-w-0 flex-1">
                        {option.depth === null && tree.path && (
                          <ParentPath
                            data={data}
                            id={option.entry.value}
                            tree={tree}
                            className="shrink-0"
                          />
                        )}
                        <RowLabel
                          data={data}
                          id={option.entry.value}
                          label={option.entry.label}
                          row={rowOfEntry(option.entry)}
                          context={{
                            as: "reference",
                            surface: "option",
                            density: "regular",
                            hierarchyShown: true,
                            selected:
                              value != null &&
                              lookupValueEquals(option.entry.value, value),
                            ...(option.role === "editing"
                              ? { editing: true }
                              : {}),
                          }}
                        />
                      </span>
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
}

// A row's parent path and the separator after it, as the table's `tree.path`
// field gives them: "Assets > Bank Accounts > ". Nothing for a top-level row.
function ParentPath({
  data,
  id,
  tree,
  className,
  ...rest
}: {
  data: TableRowData;
  id: LookupValue;
  tree: TableTree;
  className?: string;
  "data-lookup-selected-path"?: string;
}) {
  const field = tree.path!;
  const record = useRowComputedRecord(data, id, [field]);
  const path = record?.[field];
  if (typeof path !== "string" || path === "") return null;
  const text = `${path}${tree.pathSeparator ?? ""}`;
  return (
    <span
      className={cn("whitespace-pre text-sap-muted", className)}
      title={path}
      {...rest}
    >
      {text}
    </span>
  );
}

function treeErrorText(error: unknown): string {
  if (
    error instanceof ApiError &&
    typeof error.body === "object" &&
    error.body !== null &&
    "code" in error.body &&
    error.body.code === "TREE_TOO_LARGE"
  ) {
    return "Too many rows to show here. Type to search.";
  }
  return "Could not load the choices.";
}
