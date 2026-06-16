import { useEffect, useRef, useState } from "react";
import type { CellEditorProps } from "../../grid/types/schema";
import { ComboboxList } from "@sapporta/ui";
import { lookupCapabilities, presetRuntime } from "../preset";
import { useLookupOptions } from "../../grid/react/lookup";

type RowId = string;

const SEARCH_LIMIT = 50;

export function LookupValueEditor(props: CellEditorProps) {
  const columnPreset = presetRuntime(props.column)?.preset;
  const capabilities = columnPreset
    ? lookupCapabilities(columnPreset)
    : undefined;
  const searchLookup = capabilities?.searchLookup;
  const [searchText, setSearchText] = useState(() =>
    props.trigger === "type" ? props.typedSeed : "",
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const selectedValue = props.value == null ? null : String(props.value);
  const options = useLookupOptions({
    valueLookup: capabilities?.valueLookup,
    searchLookup,
    selectedValues: selectedValue ? [selectedValue] : [],
    searchText,
    limit: SEARCH_LIMIT,
  });
  const comboboxOptions = options.map((entry) => ({
    id: String(entry.value),
    label: entry.label,
  }));

  if (!searchLookup) {
    return (
      <input
        ref={inputRef}
        value=""
        readOnly
        onBlur={props.onCancel}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onCancel();
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
            props.onCancel();
          }
        }, 0);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        }
      }}
    >
      <ComboboxList
        value={selectedValue as RowId | null}
        options={comboboxOptions}
        onPick={(id) => {
          const entry = options.find((option) => String(option.value) === id);
          props.onCommit(entry ? entry.value : id);
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
