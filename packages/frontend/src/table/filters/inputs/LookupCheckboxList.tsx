import { useState } from "react";
import { Check, Search } from "lucide-react";
import {
  lookupValueEquals,
  lookupValueKey,
  type LookupValue,
} from "@sapporta/grid/lookup";
import { useLookupOptions } from "@sapporta/grid/lookup/react";
import type { LookupListInputProps } from "./types";

const SEARCH_LIMIT = 50;

export function LookupCheckboxList({
  values,
  onChange,
  lookup,
  autoFocus,
}: LookupListInputProps) {
  const [query, setQuery] = useState("");
  const options = useLookupOptions({
    valueLookup: lookup.valueLookup,
    searchLookup: lookup.searchLookup,
    selectedValues: values,
    searchText: query,
    limit: SEARCH_LIMIT,
  });

  function toggle(value: LookupValue) {
    const next = values.some((selected) => lookupValueEquals(selected, value))
      ? values.filter((selected) => !lookupValueEquals(selected, value))
      : [...values, value];
    onChange([...next]);
  }

  return (
    <div className="flex flex-col gap-[4px]">
      <div className="relative flex items-center h-sap-ctl rounded-[5px] border border-sap-border bg-sap-surface pl-[26px] pr-[8px]">
        <Search className="absolute left-[8px] h-[11px] w-[11px] text-sap-subtle" />
        <input
          autoFocus={autoFocus}
          value={query}
          placeholder="Search..."
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent outline-none text-sap-emph text-sap-fg placeholder:text-sap-subtle"
        />
      </div>
      <div className="max-h-[220px] overflow-y-auto rounded-[5px] border border-sap-border bg-sap-surface">
        {options.length === 0 ? (
          <div className="px-[10px] py-[6px] text-sap-muted text-sap-emph">
            No matches
          </div>
        ) : (
          options.map((option) => {
            const value = option.value;
            const active = values.some((selected) =>
              lookupValueEquals(selected, value),
            );
            return (
              <button
                key={lookupValueKey(value)}
                type="button"
                onClick={() => toggle(value)}
                className="w-full flex items-center gap-2 px-[10px] py-[5px] text-sap-data rounded-[3px] hover:bg-sap-row-hover text-left"
              >
                <span className="w-3 h-3 shrink-0 flex items-center justify-center text-sap-brand">
                  {active && <Check className="h-3 w-3" />}
                </span>
                <span className="flex-1 truncate">{option.label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
