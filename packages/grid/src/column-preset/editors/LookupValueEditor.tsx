import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { CellEditorProps } from "../../grid/types/schema";
import { Combobox, comboboxClassNames } from "@sapporta/ui";
import { cn } from "@sapporta/ui/cn";
import {
  isLookupValue,
  lookupValueEquals,
  lookupValueKey,
  type LookupEntry,
  type LookupValue,
} from "../../lookup";
import { lookupCapabilities, presetRuntime } from "../preset";
import { useLookupOptions } from "../../lookup/react";

const SEARCH_LIMIT = 50;

export function LookupValueEditor(props: CellEditorProps) {
  const columnPreset = presetRuntime(props.column)?.preset;
  const capabilities = columnPreset
    ? lookupCapabilities(columnPreset)
    : undefined;
  const searchLookup = capabilities?.searchLookup;
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
      >
        <Combobox.InputGroup
          className={cn(
            comboboxClassNames.inputGroup,
            "h-full rounded-none border-0 bg-transparent shadow-none",
          )}
        >
          <Combobox.Input
            ref={inputRef}
            placeholder="Search…"
            className={cn(
              comboboxClassNames.input,
              "h-full py-0 text-sap-body",
            )}
            data-grid-part="editor-input"
          />
        </Combobox.InputGroup>
        <div className="absolute left-0 top-full z-[var(--sap-z-popover)] mt-1 min-w-full overflow-hidden rounded-md border border-sap-border bg-sap-surface shadow-lg">
          <Combobox.Empty className={comboboxClassNames.empty}>
            No results.
          </Combobox.Empty>
          <Combobox.List className={cn(comboboxClassNames.list, "max-h-64")}>
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
        </div>
      </Combobox.Root>
    </div>
  );
}
