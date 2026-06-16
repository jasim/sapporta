import { useState } from "react";
import { X } from "lucide-react";
import type {
  FilterCondition,
  NewFilterCondition,
} from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui";
import { useLookupValueLabels } from "@sapporta/grid";
import type { LookupForColumn } from "@/table/lookup/column-lookup";
import { ConditionEditor } from "./ConditionEditor";
import { findEntryForCondition, inferFilterColumnType } from "./column-catalog";

export interface FilterCardProps {
  condition: FilterCondition;
  tableName?: string;
  columns: ColumnSchema[];
  lookupForColumn?: LookupForColumn;
  onUpdate: (id: string, patch: NewFilterCondition) => void;
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
  tableName,
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
    tableName,
    column,
    lookupForColumn,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="inline-flex max-w-full flex-col gap-[2px]">
        <div className="inline-flex h-sap-ctl max-w-full items-center gap-1 group-data-[toolbar-band=compact]/table-toolbar:h-11">
          <PopoverTrigger asChild>
            <button
              type="button"
              className={
                "flex min-w-0 max-w-full items-center gap-[6px] border-b bg-transparent px-0 pb-[2px] text-[17px] leading-[1.25] font-[620] text-sap-fg hover:border-sap-muted group-data-[toolbar-band=compact]/table-toolbar:h-11 " +
                (error ? "border-sap-negative" : "border-sap-border-strong")
              }
            >
              <span className="truncate text-sap-muted">{label}</span>
              <span className="shrink-0 text-sap-subtle">{opLabel}</span>
              {valueSummary && (
                <span className="truncate max-w-[180px] text-sap-fg">
                  {valueSummary}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <button
            type="button"
            aria-label={`Remove ${label} filter`}
            onClick={() => onRemove(condition.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-transparent text-sap-subtle hover:bg-sap-row-hover hover:text-sap-soft group-data-[toolbar-band=compact]/table-toolbar:h-11 group-data-[toolbar-band=compact]/table-toolbar:w-11"
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
      <PopoverContent align="start" sideOffset={4} className="p-0">
        <ConditionEditor
          columns={columns}
          lockedColumn={column}
          initial={condition}
          tableName={tableName}
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
  cond: FilterCondition,
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

function useFilterValueSummary(
  cond: FilterCondition,
  tableName: string | undefined,
  column: ColumnSchema | null,
  lookupForColumn: LookupForColumn | undefined,
): string {
  const values =
    cond.op === "is" ? [] : "values" in cond ? cond.values : [cond.value];
  const lookup =
    tableName && column?.foreignKey
      ? lookupForColumn?.({ tableName, column })
      : undefined;
  const labels = useLookupValueLabels(lookup?.valueLookup, values);
  if (cond.op === "is") return "";
  return values.map((value) => labels[value] ?? value).join(", ");
}
