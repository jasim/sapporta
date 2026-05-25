/**
 * HeaderFilterPopover — thin popover shown from a column header chevron.
 * Contains:
 *
 *   - Sort A→Z / Sort Z→A
 *   - Quick-equality picker (CheckboxList) — only for columns with a known
 *     value set (enum, boolean, fk). The picker always emits `in`; the
 *     server treats `in [x]` identically to `eq x`.
 *   - "Filter by condition…" — opens the shared ConditionEditor with the
 *     column locked.
 *   - "Clear filter" — removes every condition on this column.
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, SlidersHorizontal, X } from "lucide-react";
import type { FilterCondition, NewFilterCondition } from "@sapporta/shared/filter";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { FkOptionsMap } from "@/lookup/types";
import type { SortDescriptor } from "@sapporta/grid";
import { Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui";
import { ConditionEditor } from "./ConditionEditor";
import { CheckboxList } from "./inputs/CheckboxList";
import {
  inferFilterColumnType,
  resolveColumnOptions,
} from "./column-catalog";

export interface HeaderFilterPopoverProps {
  column: ColumnSchema;
  columns: ColumnSchema[];
  filters: FilterCondition[];
  fkOptions?: FkOptionsMap;
  sort: SortDescriptor[];
  onSort: (sort: SortDescriptor[]) => void;
  onAddFilter: (cond: NewFilterCondition) => void;
  onUpdateFilter: (id: string, patch: NewFilterCondition) => void;
  onRemoveFilter: (id: string) => void;
  children: React.ReactNode;
}

export interface HeaderFilterMenuContentProps {
  column: ColumnSchema;
  columns: ColumnSchema[];
  filters: FilterCondition[];
  fkOptions?: FkOptionsMap;
  sort: SortDescriptor[];
  onSort: (sort: SortDescriptor[]) => void;
  onAddFilter: (cond: NewFilterCondition) => void;
  onUpdateFilter: (id: string, patch: NewFilterCondition) => void;
  onRemoveFilter: (id: string) => void;
  close: () => void;
}

export function HeaderFilterPopover({
  column,
  columns,
  filters,
  fkOptions,
  sort,
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
          column={column}
          columns={columns}
          filters={filters}
          fkOptions={fkOptions}
          sort={sort}
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
  column,
  columns,
  filters,
  fkOptions,
  onSort,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  close,
}: HeaderFilterMenuContentProps) {
  const [editorOpen, setEditorOpen] = useState(false);

  const type = inferFilterColumnType(column);
  const resolved = resolveColumnOptions(column, fkOptions, type);

  // The header's quick picker owns exactly one condition on this column:
  // the `in` condition (if any). Other operators live solely as cards.
  const quickCondition = filters.find(
    (f): f is FilterCondition & { op: "in" } =>
      f.column === column.name && f.op === "in",
  );
  const quickValues = quickCondition ? quickCondition.values : [];

  function applyQuick(next: string[]) {
    if (next.length === 0) {
      if (quickCondition) onRemoveFilter(quickCondition.id);
      return;
    }
    if (quickCondition) {
      onUpdateFilter(quickCondition.id, {
        column: column.name,
        op: "in",
        values: next,
      });
    } else {
      onAddFilter({ column: column.name, op: "in", values: next });
    }
  }

  function setSortForColumn(direction: "asc" | "desc") {
    onSort([{ colId: column.name, direction }]);
    close();
  }

  function clearAllFiltersForColumn() {
    for (const f of filters) {
      if (f.column === column.name) onRemoveFilter(f.id);
    }
    close();
  }

  const hasAnyFilterOnColumn = filters.some((f) => f.column === column.name);
  const showQuickPicker = resolved !== null && resolved.options.length > 0;

  return (
    <>
        <MenuRow
          icon={<ArrowUp className="h-[12px] w-[12px]" />}
          onClick={() => setSortForColumn("asc")}
        >
          Sort A → Z
        </MenuRow>
        <MenuRow
          icon={<ArrowDown className="h-[12px] w-[12px]" />}
          onClick={() => setSortForColumn("desc")}
        >
          Sort Z → A
        </MenuRow>
        <Divider />
        {showQuickPicker && (
          <>
            <div className="px-[6px] py-[4px]">
              <CheckboxList
                values={quickValues}
                onChange={applyQuick}
                column={column}
                options={resolved.options}
                labels={resolved.labels}
              />
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
              <span className="flex-1">Filter by condition…</span>
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
              fkOptions={fkOptions}
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
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
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
  return <div className="my-[3px] border-t border-sap-border" />;
}
