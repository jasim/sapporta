/**
 * ConditionEditor — the one filter authoring component in the app. Three
 * callers invoke it (header "Filter by condition...", card click, "+ Add
 * filter"); it carries no per-caller knowledge. The column picker, operator
 * dropdown, and value input are all derived from the column-type catalog.
 */

import { useId, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type {
  FilterDraftValue,
  TypedFilterCondition,
  TypedValue,
} from "@sapporta/shared/filter";
import {
  encodeTypedValue,
  materializeTypedFilterCondition,
} from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { isLookupValue } from "@sapporta/grid/lookup";
import type { LookupForColumn } from "../../lookup";
import { Combobox, comboboxClassNames } from "@sapporta/ui/combobox";
import { cn } from "@sapporta/ui/cn";
import {
  catalog,
  findEntryForCondition,
  findOpEntry,
  inferFilterColumnType,
  opsForColumn,
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
  initial?: TypedFilterCondition | null;
  /** Cell value to prepopulate when there is no `initial`. Used by the
   *  per-cell filter icon so the draft opens with the clicked cell's value
   *  already filled in (scalar or list depending on the default operator). */
  seedValue?: unknown;
  lookupForColumn?: LookupForColumn;
  /** Called on Apply with a table-aware typed condition. */
  onApply: (cond: TypedFilterCondition) => void;
  onCancel: () => void;
}

/** The draft carries both possible value shapes simultaneously. Switching
 *  the operator never destroys the user's in-progress input for the other
 *  shape — commit picks the right one from the chosen OpEntry's valueShape. */
interface DraftState {
  column: ColumnSchema | null;
  opKey: string;
  scalarValue: string;
  listValues: FilterDraftValue[];
}

function seedToScalarString(seed: unknown): string {
  if (seed == null) return "";
  if (typeof seed === "string") return seed;
  if (typeof seed === "number" || typeof seed === "boolean")
    return String(seed);
  return "";
}

function seedToListValue(seed: unknown): FilterDraftValue | null {
  if (typeof seed === "string" || typeof seed === "number") return seed;
  if (typeof seed === "boolean") return String(seed);
  return null;
}

function draftListValue(value: TypedValue): FilterDraftValue {
  if (typeof value === "string" || typeof value === "number") return value;
  return encodeTypedValue(value);
}

function initialDraft(
  initial: TypedFilterCondition | null | undefined,
  lockedColumn: ColumnSchema | null | undefined,
  columns: ColumnSchema[],
  seedValue: unknown,
): DraftState {
  const column =
    lockedColumn ??
    (initial ? (columns.find((c) => c.name === initial.column) ?? null) : null);
  if (!column) {
    return { column: null, opKey: "", scalarValue: "", listValues: [] };
  }
  const type = inferFilterColumnType(column);
  if (!initial) {
    const opKey = catalog[type].defaultKey;
    const defaultEntry = findOpEntry(type, opKey) ?? catalog[type].ops[0];
    const scalarSeed = seedToScalarString(seedValue);
    const listSeed = seedToListValue(seedValue);
    const scalarValue = defaultEntry.valueShape === "scalar" ? scalarSeed : "";
    const listValues =
      defaultEntry.valueShape === "list" && listSeed !== null ? [listSeed] : [];
    return { column, opKey, scalarValue, listValues };
  }
  const polarity = initial.op === "is" ? initial.polarity : null;
  const entry = findEntryForCondition(type, initial.op, polarity);
  return {
    column,
    opKey: entry.key,
    scalarValue: "value" in initial ? encodeTypedValue(initial.value) : "",
    listValues: "values" in initial ? initial.values.map(draftListValue) : [],
  };
}

export function ConditionEditor({
  columns,
  lockedColumn,
  initial,
  seedValue,
  lookupForColumn,
  onApply,
  onCancel,
}: ConditionEditorProps) {
  const [draft, setDraft] = useState<DraftState>(() =>
    initialDraft(initial, lockedColumn, columns, seedValue),
  );

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
        onApply(
          materializeTypedFilterCondition(
            { column, op: entry.op, value: draft.scalarValue },
            { columns },
            initial?.id,
          ),
        );
        return;
      case "list":
        onApply(
          materializeTypedFilterCondition(
            { column, op: entry.op, values: draft.listValues },
            { columns },
            initial?.id,
          ),
        );
        return;
      case "none":
        onApply(
          materializeTypedFilterCondition(
            { column, op: "is", polarity: entry.polarity },
            { columns },
            initial?.id,
          ),
        );
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
    draft.column && type ? resolveColumnOptions(draft.column, type) : null;
  const lookup = draft.column ? lookupForColumn?.(draft.column) : undefined;

  return (
    <div
      className="flex flex-col gap-[10px] p-[12px] w-[380px] bg-sap-surface text-sap-fg"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Enter" && canApply) {
          e.stopPropagation();
          handleApply();
        }
      }}
    >
      {!lockedColumn && (
        <Field label="Column">
          <Combobox.Root<ColumnSchema>
            items={columns}
            value={draft.column}
            onValueChange={(column) => {
              if (column !== null) handleColumnChange(column.name);
            }}
            itemToStringLabel={(column) => column.label}
            itemToStringValue={(column) => column.name}
            isItemEqualToValue={(column, selected) =>
              column.name === selected.name
            }
          >
            <Combobox.Trigger
              aria-label="Choose column"
              className={comboboxClassNames.trigger}
              render={
                <button
                  type="button"
                  className="h-sap-ctl flex items-center justify-between gap-[6px] px-[10px] rounded-[5px] border border-sap-border bg-sap-surface text-sap-fg text-left hover:bg-sap-row-hover"
                />
              }
            >
              <Combobox.Value placeholder="Pick a column" />
              <ChevronDown aria-hidden />
            </Combobox.Trigger>
            <Combobox.Portal>
              <Combobox.Positioner
                align="start"
                sideOffset={4}
                className={comboboxClassNames.positioner}
              >
                <Combobox.Popup className={comboboxClassNames.popup}>
                  <Combobox.Input
                    aria-label="Search columns"
                    placeholder="Search…"
                    className={cn(
                      comboboxClassNames.input,
                      "h-9 w-full border-b py-3",
                    )}
                  />
                  <Combobox.Empty className={comboboxClassNames.empty}>
                    No results.
                  </Combobox.Empty>
                  <Combobox.List className={comboboxClassNames.list}>
                    {(column: ColumnSchema) => (
                      <Combobox.Item
                        key={column.name}
                        value={column}
                        className={comboboxClassNames.item}
                      >
                        {column.label}
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
        </Field>
      )}

      {type && draft.column && (
        <Field label="Operator">
          <Combobox.Root<OpEntry>
            items={opsForColumn(draft.column, type)}
            value={entry}
            onValueChange={(next) => {
              if (next !== null) {
                setDraft({ ...draft, opKey: next.key });
              }
            }}
            itemToStringLabel={(operator) => operator.label}
            itemToStringValue={(operator) => operator.key}
            isItemEqualToValue={(operator, selected) =>
              operator.key === selected.key
            }
          >
            <Combobox.InputGroup
              className={cn(comboboxClassNames.inputGroup, "h-sap-ctl")}
            >
              <Combobox.Input
                aria-label="Search operators"
                className={comboboxClassNames.input}
                onKeyDown={(event) => event.stopPropagation()}
              />
              <Combobox.Trigger
                aria-label="Open operator choices"
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
                    No matching operators.
                  </Combobox.Empty>
                  <Combobox.List className={comboboxClassNames.list}>
                    {(operator: OpEntry) => (
                      <Combobox.Item
                        key={operator.key}
                        value={operator}
                        className={comboboxClassNames.item}
                      >
                        {operator.label}
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
        </Field>
      )}

      {entry && draft.column && entry.valueShape === "scalar" && (
        <Field label="Value">
          <entry.Input
            value={draft.scalarValue}
            onChange={(next) => setDraft({ ...draft, scalarValue: next })}
            column={draft.column}
            op={entry.op}
            lookup={lookup}
            options={resolved?.options}
            labels={resolved?.labels}
            autoFocus={!!lockedColumn}
          />
        </Field>
      )}

      {entry && draft.column && entry.valueShape === "list" && (
        <Field label="Value">
          {entry.inputKind === "tag" && (
            <entry.Input
              values={draft.listValues.map(String)}
              onChange={(next) => setDraft({ ...draft, listValues: next })}
              column={draft.column}
              autoFocus={!!lockedColumn}
            />
          )}
          {entry.inputKind === "static" && resolved && (
            <entry.Input
              values={draft.listValues.filter(isString)}
              onChange={(next) => setDraft({ ...draft, listValues: next })}
              column={draft.column}
              options={resolved.options}
              labels={resolved.labels}
              autoFocus={!!lockedColumn}
            />
          )}
          {entry.inputKind === "lookup" && lookup && (
            <entry.Input
              values={draft.listValues.filter(isLookupValue)}
              onChange={(next) => setDraft({ ...draft, listValues: next })}
              column={draft.column}
              lookup={lookup}
              autoFocus={!!lockedColumn}
            />
          )}
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const labelId = useId();

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex flex-col gap-[4px]"
    >
      <span
        id={labelId}
        className="text-sap-label uppercase tracking-sap-head font-medium text-sap-subtle"
      >
        {label}
      </span>
      {children}
    </div>
  );
}
