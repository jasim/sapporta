/**
 * CellFilterAction — the "filter by this column" icon that appears on cell
 * hover. Click opens ConditionEditor with the column locked; the user enters
 * the operator and value. Mirrors the header chevron's "Filter by condition..."
 * flow but anchors to the cell instead of the header.
 */

import { useState } from "react";
import { Filter } from "lucide-react";
import type { TypedFilterCondition } from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { LookupForColumn } from "../../lookup";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";
import { ConditionEditor } from "./ConditionEditor";

export interface CellFilterActionProps {
  column: ColumnSchema;
  columns: ColumnSchema[];
  cellValue: unknown;
  lookupForColumn?: LookupForColumn;
  onAddFilter: (cond: TypedFilterCondition) => void;
}

export function CellFilterAction({
  column,
  columns,
  cellValue,
  lookupForColumn,
  onAddFilter,
}: CellFilterActionProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Filter by ${column.label}`}
          className="flex items-center justify-center h-6 w-6 rounded border border-sap-border bg-sap-surface text-sap-subtle hover:text-sap-fg hover:bg-sap-row-hover shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <Filter className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="p-0 w-auto border-sap-border bg-sap-surface"
      >
        <ConditionEditor
          columns={columns}
          lockedColumn={column}
          seedValue={cellValue}
          lookupForColumn={lookupForColumn}
          onApply={(cond) => {
            onAddFilter(cond);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
