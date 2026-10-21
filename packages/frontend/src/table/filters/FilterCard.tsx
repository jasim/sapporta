import { Fragment, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { TypedFilterCondition } from "@sapporta/shared/filter";
import { encodeTypedValue } from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";
import { isLookupValue, type LookupValue } from "@sapporta/grid/lookup";
import { useLookupValueLabels } from "@sapporta/grid/lookup/react";
import type { LookupForColumn } from "../../lookup";
import { isTableRowData, type TableRowData } from "../../lookup/row-data";
import {
  RowLabel,
  rowCaptionField,
  rowCaptionText,
  rowOfEntry,
  useRowComputedRecord,
} from "../../lookup/row-display";
import { ConditionEditor } from "./ConditionEditor";
import { findEntryForCondition, inferFilterColumnType } from "./column-catalog";

export interface FilterCardProps {
  condition: TypedFilterCondition;
  columns: ColumnSchema[];
  lookupForColumn?: LookupForColumn;
  onUpdate: (id: string, patch: TypedFilterCondition) => void;
  onRemove: (id: string) => void;
  /** Backend-reported error scoped to this condition (by id). Rendered
   *  under the pill so the user can tie the message to the offending
   *  filter. */
  error?: string | null;
}

/** Pill display for one active filter: `{column} {label} {value}`. Clicking
 *  the body opens a ConditionEditor popover loaded with the condition; the
 *  trailing × removes it. */
export function FilterCard({
  condition,
  columns,
  lookupForColumn,
  onUpdate,
  onRemove,
  error,
}: FilterCardProps) {
  const [open, setOpen] = useState(false);

  const column = columns.find((c) => c.name === condition.column) ?? null;
  const label = column?.label ?? condition.column;
  const opLabel = summarizeOperator(condition, column);
  const valueSummary = useFilterValueSummary(
    condition,
    column,
    lookupForColumn,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="inline-flex max-w-full flex-col gap-[2px]">
        <div className="inline-flex h-sap-ctl max-w-full items-center gap-1">
          <PopoverTrigger
            render={
              <button
                type="button"
                className={
                  "flex min-w-0 max-w-full items-center gap-[6px] border-b bg-transparent px-0 pb-[2px] text-sap-body leading-[1.25] font-[620] text-sap-fg hover:border-sap-muted " +
                  (error ? "border-sap-negative" : "border-sap-border-strong")
                }
              />
            }
          >
            <span className="truncate text-sap-muted">{label}</span>
            <span className="shrink-0 text-sap-subtle">{opLabel}</span>
            {valueSummary && (
              <span className="truncate max-w-[180px] text-sap-fg">
                {valueSummary}
              </span>
            )}
          </PopoverTrigger>
          <button
            type="button"
            aria-label={`Remove ${label} filter`}
            onClick={() => onRemove(condition.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-transparent text-sap-subtle hover:bg-sap-row-hover hover:text-sap-soft"
          >
            <X className="h-[11px] w-[11px]" />
          </button>
        </div>
        {error && (
          <span className="text-sap-tiny text-sap-negative px-[4px]">
            {error}
          </span>
        )}
      </div>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="rounded-xl p-0 shadow-sap-elevated"
      >
        <ConditionEditor
          columns={columns}
          lockedColumn={column}
          initial={condition}
          lookupForColumn={lookupForColumn}
          onApply={(patch) => {
            onUpdate(condition.id, patch);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export function summarizeOperator(
  cond: TypedFilterCondition,
  column: ColumnSchema | null,
): string {
  // Keep single-choice list filters conversational:
  // "Author is Jack Weatherford", not "Author is one of Jack Weatherford".
  if (cond.op === "in" && cond.values.length === 1) return "is";
  if (cond.op === "nin" && cond.values.length === 1) return "is not";

  if (!column) return cond.op;

  return findEntryForCondition(
    inferFilterColumnType(column),
    cond.op,
    cond.op === "is" ? cond.polarity : null,
  ).label;
}

/** The filter's values, each lookup value drawn with its table's row
 *  display, separated by commas. `null` when the operator takes no value. */
function useFilterValueSummary(
  cond: TypedFilterCondition,
  column: ColumnSchema | null,
  lookupForColumn: LookupForColumn | undefined,
): ReactNode {
  const values =
    cond.op === "is" ? [] : "values" in cond ? cond.values : [cond.value];
  const lookup = column?.foreignKey ? lookupForColumn?.(column) : undefined;
  const rowData = lookup && isTableRowData(lookup) ? lookup : undefined;
  const lookupValues = values.filter(isLookupValue);
  const labels = useLookupValueLabels(lookup?.valueLookup, lookupValues);
  if (cond.op === "is" || values.length === 0) return null;
  return values.map((value, index) => {
    const separator = index > 0 ? ", " : null;
    if (!isLookupValue(value)) {
      return (
        <Fragment key={index}>
          {separator}
          {encodeTypedValue(value)}
        </Fragment>
      );
    }
    const label = labels.labelFor(value) ?? String(value);
    return (
      <Fragment key={index}>
        {separator}
        {rowData ? (
          <FilterValueChip data={rowData} id={value} label={label} />
        ) : (
          label
        )}
      </Fragment>
    );
  });
}

/** One chosen row in a filter chip: its label slot's chip drawing, with the
 *  table's caption as the tooltip. */
function FilterValueChip({
  data,
  id,
  label,
}: {
  data: TableRowData;
  id: LookupValue;
  label: string;
}) {
  const schema = data.schema();
  const captionField = rowCaptionField(schema);
  const computed = useRowComputedRecord(
    data,
    id,
    captionField ? [captionField] : [],
  );
  const entry = data.valueLookup.entryForValue(id);
  const row = entry ? rowOfEntry(entry) : undefined;
  const caption = rowCaptionText(schema, computed, row);
  return (
    <span title={caption ?? undefined} data-filter-value="">
      <RowLabel
        data={data}
        id={id}
        label={label}
        row={row}
        context={{
          as: "reference",
          surface: "chip",
          density: "regular",
          hierarchyShown: false,
        }}
      />
    </span>
  );
}
