import { useState } from "react";
import { X } from "lucide-react";
import type { FilterCondition, NewFilterCondition } from "@sapporta/shared/filter";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { FkOptionsMap } from "../../../types";
import { ConditionEditor } from "./ConditionEditor";
import {
  findEntryForCondition,
  inferFilterColumnType,
} from "./column-catalog";

export interface FilterCardProps {
  condition: FilterCondition;
  columns: ColumnSchema[];
  fkOptions?: FkOptionsMap;
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
  columns,
  fkOptions,
  onUpdate,
  onRemove,
  error,
}: FilterCardProps) {
  const [open, setOpen] = useState(false);

  const column = columns.find((c) => c.name === condition.column) ?? null;
  const label = column?.header ?? condition.column;
  const opLabel = column
    ? findEntryForCondition(
        inferFilterColumnType(column),
        condition.op,
        condition.op === "is" ? condition.polarity : null,
      ).label
    : condition.op;
  const valueSummary = summarizeValue(condition, column, fkOptions);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="inline-flex flex-col gap-[2px]">
        <div
          className={
            "inline-flex items-stretch h-sap-ctl rounded-[5px] border overflow-hidden " +
            (error ? "border-sap-negative" : "border-sap-border")
          }
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-[6px] px-[10px] bg-sap-surface hover:bg-sap-row-hover text-sap-fg text-sap-emph"
            >
              <span className="text-sap-muted">{label}</span>
              <span className="text-sap-subtle">{opLabel}</span>
              {valueSummary && (
                <span className="font-medium truncate max-w-[180px]">
                  {valueSummary}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <button
            type="button"
            aria-label={`Remove ${label} filter`}
            onClick={() => onRemove(condition.id)}
            className="flex items-center px-[8px] bg-sap-surface hover:bg-sap-row-hover text-sap-muted hover:text-sap-fg border-l border-sap-border"
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
          fkOptions={fkOptions}
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

function summarizeValue(
  cond: FilterCondition,
  column: ColumnSchema | null,
  fkOptions?: FkOptionsMap,
): string {
  // The opLabel already reads "is empty" / "is not empty" for null-checks.
  if (cond.op === "is") return "";
  const values = "values" in cond ? cond.values : [cond.value];
  const lookup = column?.foreignKey ? fkOptions?.[cond.column] : undefined;
  return values.map((v) => lookup?.[v] ?? v).join(", ");
}
