import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CellEditorProps } from "../../grid/types/schema";
import { ComboboxList } from "../../components/ui/combobox";
import type { RowId } from "../../lib/row-id";
import { lookupCapabilities, presetRuntime } from "../preset";

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
    if (!searchLookup) return;
    void searchLookup.loadSearchResults({
      searchText,
      limit: SEARCH_LIMIT,
    });
  }, [searchLookup, searchText]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const options = useSyncExternalStore(
    (listener) =>
      searchLookup?.subscribeToLookupChanges(listener) ?? subscribeNoop(),
    () => searchLookup?.cachedSearchResults({ searchText }) ?? EMPTY_RESULTS,
  );
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
        className="grid-editor-input h-full w-full"
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
        value={props.value == null ? null : (String(props.value) as RowId)}
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
        listClassName="absolute left-0 top-full z-50 mt-1 max-h-64 min-w-full overflow-auto rounded-md border border-sap-border bg-sap-surface shadow-lg"
      />
    </div>
  );
}

const EMPTY_RESULTS: readonly [] = [];

function subscribeNoop() {
  return () => {};
}
