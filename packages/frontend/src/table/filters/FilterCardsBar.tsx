import { useState, useMemo } from "react";
import { Plus } from "lucide-react";
import type {
  FilterCondition,
  NewFilterCondition,
} from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import { cn } from "@sapporta/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";
import type { LookupForColumn } from "@/table/lookup/column-lookup";
import { ConditionEditor } from "./ConditionEditor";
import { FilterCard } from "./FilterCard";
import { DateRangeCard, groupDateRanges } from "./DateRangeCard";

export interface FilterCardsBarProps {
  tableName?: string;
  columns: ColumnSchema[];
  filters: FilterCondition[];
  lookupForColumn?: LookupForColumn;
  onAdd: (cond: NewFilterCondition) => void;
  onUpdate: (id: string, patch: NewFilterCondition) => void;
  onRemove: (id: string) => void;
  /** Per-condition backend error keyed by condition id. */
  filterErrors?: Record<string, string>;
  className?: string;
}

/** Persistent overview of active filters. When no filters are set,
 *  collapses to a single `+ Add filter` affordance. Each card owns its own
 *  ConditionEditor popover; the bar itself owns the "add" popover. */
export function FilterCardsBar({
  tableName,
  columns,
  filters,
  lookupForColumn,
  onAdd,
  onUpdate,
  onRemove,
  filterErrors,
  className,
}: FilterCardsBarProps) {
  const [addOpen, setAddOpen] = useState(false);

  const filterableColumns = columns.filter((c) => !c.visuallyHidden);
  const columnsByName = useMemo(() => {
    const m = new Map<string, ColumnSchema>();
    for (const c of filterableColumns) m.set(c.name, c);
    return m;
  }, [filterableColumns]);

  const entries = useMemo(
    () => groupDateRanges(filters, columnsByName),
    [filters, columnsByName],
  );

  if (filterableColumns.length === 0 && filters.length === 0) return null;

  return (
    <div
      className={cn(
        "shrink-0 flex flex-wrap items-center gap-3 px-5 pt-[14px] pb-4 bg-sap-surface",
        className,
      )}
    >
      {entries.map((entry) =>
        entry.kind === "range" ? (
          <DateRangeCard
            key={`range-${entry.range.gte.id}-${entry.range.lte.id}`}
            range={entry.range}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ) : (
          <FilterCard
            key={entry.condition.id}
            condition={entry.condition}
            tableName={tableName}
            columns={filterableColumns}
            lookupForColumn={lookupForColumn}
            onUpdate={onUpdate}
            onRemove={onRemove}
            error={filterErrors?.[entry.condition.id] ?? null}
          />
        ),
      )}
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-[4px] h-sap-ctl px-[10px] rounded-[6px] border border-sap-border-soft text-sap-muted hover:text-sap-fg hover:bg-sap-row-hover text-sap-data font-semibold"
          >
            <Plus className="h-[11px] w-[11px]" />
            Add filter
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="p-0 w-auto border-sap-border bg-sap-surface"
        >
          <ConditionEditor
            columns={filterableColumns}
            tableName={tableName}
            lookupForColumn={lookupForColumn}
            onApply={(cond) => {
              onAdd(cond);
              setAddOpen(false);
            }}
            onCancel={() => setAddOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
