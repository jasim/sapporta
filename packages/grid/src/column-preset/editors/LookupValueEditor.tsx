import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { CellEditorProps } from "../../core/types/schema";
import { Combobox, comboboxClassNames } from "@sapporta/ui";
import { cn } from "@sapporta/ui/cn";
import {
  isLookupValue,
  lookupValueEquals,
  lookupValueKey,
  type LookupEntry,
  type LookupValue,
} from "../../lookup";
import {
  lookupCapabilities,
  lookupEntryRenderer,
  presetRuntime,
} from "../preset";
import { useLookupOptions } from "../../lookup/react";

const SEARCH_LIMIT = 50;

export function LookupValueEditor(props: CellEditorProps) {
  const columnPreset = presetRuntime(props.column)?.preset;
  const capabilities = columnPreset
    ? lookupCapabilities(columnPreset)
    : undefined;
  const searchLookup = capabilities?.searchLookup;
  const renderEntry = columnPreset
    ? lookupEntryRenderer(columnPreset)
    : undefined;
  const [searchText, setSearchText] = useState(() =>
    props.editStart.trigger === "type" ? props.editStart.typedSeed : "",
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const selectedValue: LookupValue | null = isLookupValue(props.value)
    ? props.value
    : null;
  const options = useLookupOptions({
    valueLookup: capabilities?.valueLookup,
    searchLookup,
    selectedValues: selectedValue == null ? [] : [selectedValue],
    searchText,
    limit: SEARCH_LIMIT,
  });
  const selectedEntry =
    selectedValue == null
      ? null
      : (options.find((entry) =>
          lookupValueEquals(entry.value, selectedValue),
        ) ?? null);

  if (!searchLookup) {
    return (
      <input
        ref={inputRef}
        value=""
        readOnly
        onBlur={props.cancel}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.cancel();
        }}
        className="h-full w-full"
        data-grid-part="editor-input"
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full"
      onBlurCapture={() => {
        window.setTimeout(() => {
          if (!rootRef.current?.contains(document.activeElement)) {
            props.cancel();
          }
        }, 0);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.cancel();
        }
      }}
    >
      <Combobox.Root
        items={options}
        value={selectedEntry}
        onValueChange={(entry) => {
          if (entry !== null) props.commit(entry.value);
        }}
        inputValue={searchText}
        onInputValueChange={setSearchText}
        isItemEqualToValue={(entry, selected) =>
          lookupValueEquals(entry.value, selected.value)
        }
        filter={null}
        open
        onOpenChange={(open, details) => {
          // The positioned popup handles Escape itself to close the list,
          // so the wrapper's keydown handler never sees it. Closing the list
          // ends the edit.
          if (!open && details.reason === "escape-key") props.cancel();
        }}
      >
        <Combobox.InputGroup
          className={cn(
            comboboxClassNames.inputGroup,
            "h-full rounded-none border-0 bg-transparent shadow-none",
          )}
        >
          <Combobox.Input
            ref={inputRef}
            // The current value is the first option; the placeholder names it
            // too, so the cell keeps showing it while the search is empty.
            placeholder={selectedEntry?.label ?? "Search…"}
            className={cn(
              comboboxClassNames.input,
              "h-full py-0 text-sap-body",
            )}
            data-grid-part="editor-input"
          />
        </Combobox.InputGroup>
        <Combobox.Portal>
          <Combobox.Positioner
            align="start"
            sideOffset={4}
            className={comboboxClassNames.positioner}
          >
            <Combobox.Popup
              className={cn(
                comboboxClassNames.popup,
                "w-auto min-w-(--anchor-width)",
              )}
            >
              <Combobox.Empty className={comboboxClassNames.empty}>
                No results.
              </Combobox.Empty>
              <Combobox.List
                className={cn(comboboxClassNames.list, "max-h-64")}
              >
                {(entry: LookupEntry) => (
                  <Combobox.Item
                    key={lookupValueKey(entry.value)}
                    value={entry}
                    disabled={entry.disabled}
                    className={comboboxClassNames.item}
                  >
                    {renderEntry
                      ? renderEntry({
                          entry,
                          surface: "option",
                          density: "compact",
                          selected:
                            selectedValue != null &&
                            lookupValueEquals(entry.value, selectedValue),
                          defaultContent: entry.label,
                        })
                      : entry.label}
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
    </div>
  );
}
