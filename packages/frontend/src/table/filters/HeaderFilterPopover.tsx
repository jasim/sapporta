/**
 * HeaderFilterPopover — thin popover shown from a column header chevron.
 * Contains:
 *
 *   - Sort A->Z / Sort Z->A
 *   - Quick-equality picker for columns with a known value source.
 *   - "Filter by condition..." — opens the shared ConditionEditor with the
 *     column locked.
 *   - "Clear filter" — removes every condition on this column.
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, SlidersHorizontal, X } from "lucide-react";
import type {
  FilterCondition,
  NewFilterCondition,
} from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { SortDescriptor } from "@sapporta/grid";
import type { LookupForColumn } from "@/table/lookup/column-lookup";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui/popover";
import { ConditionEditor } from "./ConditionEditor";
import {
  catalog,
  inferFilterColumnType,
  resolveColumnOptions,
} from "./column-catalog";

export interface HeaderFilterPopoverProps {
  tableName?: string;
  column: ColumnSchema;
  columns: ColumnSchema[];
  filters: FilterCondition[];
  lookupForColumn?: LookupForColumn;
  sort: SortDescriptor[];
  sortColumnId?: string;
  onSort: (sort: SortDescriptor[]) => void;
  onAddFilter: (cond: NewFilterCondition) => void;
  onUpdateFilter: (id: string, patch: NewFilterCondition) => void;
  onRemoveFilter: (id: string) => void;
  children: React.ReactNode;
}

export interface HeaderFilterMenuContentProps {
  tableName?: string;
  column: ColumnSchema;
  columns: ColumnSchema[];
  filters: FilterCondition[];
  lookupForColumn?: LookupForColumn;
  sort: SortDescriptor[];
  sortColumnId?: string;
  onSort: (sort: SortDescriptor[]) => void;
  onAddFilter: (cond: NewFilterCondition) => void;
  onUpdateFilter: (id: string, patch: NewFilterCondition) => void;
  onRemoveFilter: (id: string) => void;
  close: () => void;
}

export function HeaderFilterPopover({
  tableName,
  column,
  columns,
  filters,
  lookupForColumn,
  sort,
  sortColumnId,
  onSort,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  children,
}: HeaderFilterPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="p-1 w-[240px] border-sap-border bg-sap-surface"
      >
        <HeaderFilterMenuContent
          tableName={tableName}
          column={column}
          columns={columns}
          filters={filters}
          lookupForColumn={lookupForColumn}
          sort={sort}
          sortColumnId={sortColumnId}
          onSort={onSort}
          onAddFilter={onAddFilter}
          onUpdateFilter={onUpdateFilter}
          onRemoveFilter={onRemoveFilter}
          close={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export function HeaderFilterMenuContent({
  tableName,
  column,
  columns,
  filters,
  lookupForColumn,
  onSort,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  close,
  sortColumnId,
}: HeaderFilterMenuContentProps) {
  const [editorOpen, setEditorOpen] = useState(false);

  const type = inferFilterColumnType(column);
  const columnName = column.name;
  const resolved = resolveColumnOptions(column, type);
  const lookup =
    tableName && column.foreignKey
      ? lookupForColumn?.({ tableName, column })
      : undefined;
  const quickEntry =
    catalog[type].ops.find(
      (entry) => entry.valueShape === "list" && entry.op === "in",
    ) ?? null;
  const QuickInput =
    quickEntry?.valueShape === "list" ? quickEntry.Input : null;

  // The header's quick picker owns exactly one condition on this column:
  // the `in` condition (if any). Other operators live solely as cards.
  const quickCondition = filters.find(
    (f): f is FilterCondition & { op: "in" } =>
      f.column === columnName && f.op === "in",
  );
  const quickValues = quickCondition ? quickCondition.values : [];

  function applyQuick(next: string[]) {
    if (next.length === 0) {
      if (quickCondition) onRemoveFilter(quickCondition.id);
      return;
    }
    if (quickCondition) {
      onUpdateFilter(quickCondition.id, {
        column: columnName,
        op: "in",
        values: next,
      });
    } else {
      onAddFilter({ column: columnName, op: "in", values: next });
    }
  }

  function setSortForColumn(direction: "asc" | "desc") {
    onSort([{ colId: sortColumnId ?? columnName, direction }]);
    close();
  }

  function clearAllFiltersForColumn() {
    for (const f of filters) {
      if (f.column === columnName) onRemoveFilter(f.id);
    }
    close();
  }

  const hasAnyFilterOnColumn = filters.some((f) => f.column === columnName);
  const showQuickPicker =
    quickEntry !== null &&
    (type === "fk" || (resolved !== null && resolved.options.length > 0));

  return (
    <>
      <MenuRow
        icon={<ArrowUp className="h-[12px] w-[12px]" />}
        onClick={() => setSortForColumn("asc")}
      >
        Sort A to Z
      </MenuRow>
      <MenuRow
        icon={<ArrowDown className="h-[12px] w-[12px]" />}
        onClick={() => setSortForColumn("desc")}
      >
        Sort Z to A
      </MenuRow>
      <Divider />
      {showQuickPicker && (
        <>
          <div className="px-[6px] py-[4px]">
            {QuickInput && (
              <QuickInput
                values={quickValues}
                onChange={applyQuick}
                column={column}
                lookup={lookup}
                options={resolved?.options}
                labels={resolved?.labels}
              />
            )}
          </div>
          <Divider />
        </>
      )}
      <Popover open={editorOpen} onOpenChange={setEditorOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-[10px] py-[5px] text-sap-data rounded-[3px] hover:bg-sap-row-hover text-left text-sap-emph"
          >
            <SlidersHorizontal className="h-[12px] w-[12px] text-sap-subtle" />
            <span className="flex-1">Filter by condition...</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="p-0 w-auto border-sap-border bg-sap-surface"
        >
          <ConditionEditor
            columns={columns}
            lockedColumn={column}
            tableName={tableName}
            lookupForColumn={lookupForColumn}
            onApply={(cond) => {
              onAddFilter(cond);
              setEditorOpen(false);
              close();
            }}
            onCancel={() => setEditorOpen(false)}
          />
        </PopoverContent>
      </Popover>
      {hasAnyFilterOnColumn && (
        <>
          <Divider />
          <MenuRow
            icon={<X className="h-[12px] w-[12px]" />}
            onClick={clearAllFiltersForColumn}
          >
            Clear filter
          </MenuRow>
        </>
      )}
    </>
  );
}

function MenuRow({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-[10px] py-[5px] text-sap-data rounded-[3px] hover:bg-sap-row-hover text-left text-sap-emph"
    >
      <span className="text-sap-subtle">{icon}</span>
      <span className="flex-1">{children}</span>
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-sap-border-soft" />;
}
