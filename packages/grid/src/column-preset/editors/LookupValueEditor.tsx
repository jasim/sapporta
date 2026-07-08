import { useEffect, useRef, useState } from "react";
import type { CellEditorProps } from "../../grid/types/schema";
import { ComboboxList } from "@sapporta/ui";
import { isLookupValue, type LookupValue } from "../../lookup";
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
  const comboboxOptions = options.map((entry) => ({
    id: entry.value,
    label: entry.label,
  }));

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
      <ComboboxList
        value={selectedValue}
        options={comboboxOptions}
        onPick={(value) => {
          if (value != null) props.commit(value);
        }}
        inputRef={inputRef}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        shouldFilter={false}
        allowClear={false}
        className="h-full rounded-none border-0 bg-transparent shadow-none"
        inputClassName="h-full py-0 text-sap-body"
        listClassName="absolute left-0 top-full z-[var(--sap-z-popover)] mt-1 max-h-64 min-w-full overflow-auto rounded-md border border-sap-border bg-sap-surface shadow-lg"
      />
    </div>
  );
}
