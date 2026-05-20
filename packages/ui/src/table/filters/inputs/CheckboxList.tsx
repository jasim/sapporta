import { useState, useMemo } from "react";
import { Check, Search } from "lucide-react";
import type { ListInputProps } from "./types";

/** Searchable list of ticked options. Used by enum / fk columns for `in`
 *  and `nin`, and by the HeaderFilterPopover's quick-equality picker.
 *  The caller renders labels via `labels`, falling back to the raw value. */
export function CheckboxList({
  values,
  onChange,
  options,
  labels,
  autoFocus,
}: ListInputProps) {
  const selected = new Set(values);
  const [query, setQuery] = useState("");

  const opts = options ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((o) => {
      const label = labels?.[o] ?? o;
      return o.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    });
  }, [opts, labels, query]);

  function toggle(opt: string) {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange([...next]);
  }

  return (
    <div className="flex flex-col gap-[4px]">
      <div className="relative flex items-center h-sap-ctl rounded-[5px] border border-sap-border bg-sap-surface pl-[26px] pr-[8px]">
        <Search className="absolute left-[8px] h-[11px] w-[11px] text-sap-subtle" />
        <input
          autoFocus={autoFocus}
          value={query}
          placeholder="Search…"
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent outline-none text-sap-emph text-sap-fg placeholder:text-sap-subtle"
        />
      </div>
      <div className="max-h-[220px] overflow-y-auto rounded-[5px] border border-sap-border bg-sap-surface">
        {filtered.length === 0 ? (
          <div className="px-[10px] py-[6px] text-sap-muted text-sap-emph">
            No matches
          </div>
        ) : (
          filtered.map((opt) => {
            const active = selected.has(opt);
            const label = labels?.[opt] ?? opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className="w-full flex items-center gap-2 px-[10px] py-[5px] text-sap-data rounded-[3px] hover:bg-sap-row-hover text-left"
              >
                <span className="w-3 h-3 shrink-0 flex items-center justify-center text-sap-brand">
                  {active && <Check className="h-3 w-3" />}
                </span>
                <span className="flex-1 truncate">{label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
