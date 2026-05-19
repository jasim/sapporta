/**
 * ConditionEditor — the one filter authoring component in the app. Three
 * callers invoke it (header "Filter by condition…", card click, "+ Add
 * filter"); it carries no per-caller knowledge. The column picker, operator
 * dropdown, and value input are all derived from the column-type catalog —
 * no `switch` on `columnType` or `op` lives here.
 */

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FilterCondition, NewFilterCondition } from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { FkOptionsMap } from "../../../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../ui/command";
import {
  catalog,
  findEntryForCondition,
  findOpEntry,
  inferFilterColumnType,
  resolveColumnOptions,
  type FilterColumnType,
  type OpEntry,
} from "./column-catalog";

export interface ConditionEditorProps {
  /** All columns on the table. When the column is locked, the picker is
   *  omitted; the column is still needed to resolve the catalog entry. */
  columns: ColumnSchema[];
  /** When set, the column picker is hidden and the caller-supplied column
   *  is used. Opened from header / card for that column. */
  lockedColumn?: ColumnSchema | null;
  /** Existing condition to edit, if any. */
  initial?: FilterCondition | null;
  /** Cell value to prepopulate when there is no `initial`. Used by the
   *  per-cell filter icon so the draft opens with the clicked cell's value
   *  already filled in (scalar or list depending on the default operator). */
  seedValue?: unknown;
  /** Controller fkOptions, keyed by column name — populated as rows load. */
  fkOptions?: FkOptionsMap;
  /** Called on Apply with a fresh condition (no id yet — the controller
   *  mints one on addFilter, or preserves it on updateFilter). */
  onApply: (cond: NewFilterCondition) => void;
  onCancel: () => void;
}

/** The draft carries both possible value shapes simultaneously. Switching
 *  the operator never destroys the user's in-progress input for the other
 *  shape — commit picks the right one from the chosen OpEntry's valueShape. */
interface DraftState {
  column: ColumnSchema | null;
  opKey: string;
  scalarValue: string;
  listValues: string[];
}

function seedToString(seed: unknown): string {
  if (seed == null) return "";
  if (typeof seed === "string") return seed;
  if (typeof seed === "number" || typeof seed === "boolean") return String(seed);
  return "";
}

function initialDraft(
  initial: FilterCondition | null | undefined,
  lockedColumn: ColumnSchema | null | undefined,
  columns: ColumnSchema[],
  seedValue: unknown,
): DraftState {
  const column =
    lockedColumn ??
    (initial ? columns.find((c) => c.name === initial.column) ?? null : null);
  if (!column) {
    return { column: null, opKey: "", scalarValue: "", listValues: [] };
  }
  const type = inferFilterColumnType(column);
  if (!initial) {
    const opKey = catalog[type].defaultKey;
    const defaultEntry = findOpEntry(type, opKey) ?? catalog[type].ops[0];
    const seed = seedToString(seedValue);
    const scalarValue = defaultEntry.valueShape === "scalar" ? seed : "";
    const listValues =
      defaultEntry.valueShape === "list" && seed !== "" ? [seed] : [];
    return { column, opKey, scalarValue, listValues };
  }
  const polarity = initial.op === "is" ? initial.polarity : null;
  const entry = findEntryForCondition(type, initial.op, polarity);
  return {
    column,
    opKey: entry.key,
    scalarValue: "value" in initial ? initial.value : "",
    listValues: "values" in initial ? initial.values : [],
  };
}

export function ConditionEditor({
  columns,
  lockedColumn,
  initial,
  seedValue,
  fkOptions,
  onApply,
  onCancel,
}: ConditionEditorProps) {
  const [draft, setDraft] = useState<DraftState>(() =>
    initialDraft(initial, lockedColumn, columns, seedValue),
  );
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);

  const type: FilterColumnType | null = draft.column
    ? inferFilterColumnType(draft.column)
    : null;

  const entry: OpEntry | null = useMemo(() => {
    if (!type) return null;
    return findOpEntry(type, draft.opKey) ?? catalog[type].ops[0];
  }, [type, draft.opKey]);

  function handleColumnChange(name: string) {
    const col = columns.find((c) => c.name === name);
    if (!col) return;
    const t = inferFilterColumnType(col);
    setDraft({
      column: col,
      opKey: catalog[t].defaultKey,
      scalarValue: "",
      listValues: [],
    });
  }

  function handleApply() {
    if (!draft.column || !entry) return;
    const column = draft.column.name;
    switch (entry.valueShape) {
      case "scalar":
        onApply({ column, op: entry.op, value: draft.scalarValue });
        return;
      case "list":
        onApply({ column, op: entry.op, values: draft.listValues });
        return;
      case "none":
        onApply({ column, op: "is", polarity: entry.polarity });
        return;
    }
  }

  const canApply = (() => {
    if (!draft.column || !entry) return false;
    if (entry.valueShape === "none") return true;
    if (entry.valueShape === "list") return draft.listValues.length > 0;
    return draft.scalarValue.trim() !== "";
  })();

  const resolved =
    draft.column && type
      ? resolveColumnOptions(draft.column, fkOptions, type)
      : null;

  return (
    <div
      className="flex flex-col gap-[10px] p-[12px] w-[380px] bg-sap-surface text-sap-fg"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Enter" && canApply) {
          // Commit on Enter from any scalar input; TagInput intercepts Enter
          // for its own tag commit and won't bubble.
          e.stopPropagation();
          handleApply();
        }
      }}
    >
      {!lockedColumn && (
        <Field label="Column">
          <Popover open={columnPickerOpen} onOpenChange={setColumnPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-sap-ctl flex items-center justify-between gap-[6px] px-[10px] rounded-[5px] border border-sap-border bg-sap-surface text-sap-fg text-left hover:bg-sap-row-hover"
              >
                <span className={draft.column ? "" : "text-sap-muted"}>
                  {draft.column
                    ? draft.column.header ?? draft.column.name
                    : "Pick a column"}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[--radix-popover-trigger-width] p-0"
              align="start"
              sideOffset={4}
            >
              <Command>
                <CommandInput placeholder="Search columns…" />
                <CommandList>
                  <CommandEmpty>No columns.</CommandEmpty>
                  <CommandGroup>
                    {columns.map((c) => {
                      const label = c.header ?? c.name;
                      return (
                        <CommandItem
                          key={c.name}
                          value={`${label} ${c.name}`}
                          onSelect={() => {
                            handleColumnChange(c.name);
                            setColumnPickerOpen(false);
                          }}
                        >
                          {label}
                          {draft.column?.name === c.name && (
                            <span className="ml-auto text-xs text-sap-muted">
                              ✓
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </Field>
      )}

      {type && (
        <Field label="Operator">
          <Select
            value={draft.opKey}
            onValueChange={(nextKey) => setDraft({ ...draft, opKey: nextKey })}
          >
            <SelectTrigger className="h-sap-ctl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog[type].ops.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {entry && draft.column && entry.valueShape === "scalar" && (
        <Field label="Value">
          <entry.Input
            value={draft.scalarValue}
            onChange={(next) => setDraft({ ...draft, scalarValue: next })}
            column={draft.column}
            options={resolved?.options}
            labels={resolved?.labels}
            autoFocus={!!lockedColumn}
          />
        </Field>
      )}

      {entry && draft.column && entry.valueShape === "list" && (
        <Field label="Value">
          <entry.Input
            values={draft.listValues}
            onChange={(next) => setDraft({ ...draft, listValues: next })}
            column={draft.column}
            options={resolved?.options}
            labels={resolved?.labels}
            autoFocus={!!lockedColumn}
          />
        </Field>
      )}

      <div className="flex items-center justify-end gap-[6px] pt-[4px]">
        <button
          type="button"
          onClick={onCancel}
          className="h-sap-ctl px-[10px] rounded-[5px] border border-sap-border bg-sap-surface text-sap-fg text-sap-emph hover:bg-sap-row-hover"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!canApply}
          className="h-sap-ctl px-[10px] rounded-[5px] bg-primary text-primary-foreground text-sap-emph font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[4px]">
      <span className="text-sap-label uppercase tracking-sap-head font-medium text-sap-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
