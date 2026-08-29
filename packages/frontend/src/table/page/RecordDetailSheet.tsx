/**
 * Record detail sheet: the narrow-cards drill-in for one table row.
 *
 * Tapping a card opens this bottom sheet with every visible field of the row
 * as a label/value line. Tapping an editable line swaps it for the framework's
 * form control for that column, and Save writes through the grid runtime's
 * cell patch path — the same optimistic write, custom `saveCellValue`
 * handlers, and failure banner that inline grid edits use.
 *
 * The sheet reads the displayed row live from the grid runtime, so a saved
 * value (or a concurrent grid update) is reflected immediately, and the sheet
 * closes itself when the row leaves the displayed set.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronRight } from "lucide-react";
import type {
  ColId,
  GridLevelRuntime,
  GridPath,
  LevelRow,
  RowId,
} from "@sapporta/grid";
import { isLookupValue, type LookupCapabilities } from "@sapporta/grid/lookup";
import { Button } from "@sapporta/ui/button";
import { cn } from "@sapporta/ui/cn";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@sapporta/ui/sheet";
import { parseTablePatchValueDraft } from "../model/table-value-draft";
import { FormField } from "../form/FormField";
import type { TGridSession } from "../tgrid/tgrid-session";
import type { TGridLevelId, TGridRowsByLevel } from "../tgrid/tgrid-types";
import {
  buildRecordDetailFields,
  formatRecordFieldValue,
  isMonoRecordField,
  recordDetailTitle,
  recordFieldDraft,
  type RecordDetailField,
} from "./record-detail-fields";

export type RecordDetailTarget = {
  levelId: string;
  rowId: RowId;
  path: GridPath;
};

type FieldEditState = {
  colId: ColId;
  draft: unknown;
  issue?: string;
};

export function RecordDetailSheet<
  RowsByLevel extends TGridRowsByLevel,
  AppServices = unknown,
>({
  session,
  target,
  onClose,
}: {
  session: TGridSession<RowsByLevel, AppServices>;
  target: RecordDetailTarget | null;
  onClose: () => void;
}) {
  const level = useMemo(() => {
    if (!target) return null;
    try {
      return session.runtime.level(target.path);
    } catch {
      return null;
    }
  }, [session, target]);

  const row = useDisplayedRowOrNull(level, target?.rowId ?? null);
  const table = target
    ? session.levels[target.levelId as TGridLevelId<RowsByLevel>]?.table
    : undefined;

  // A page change, deletion, or collapsed parent removes the row from the
  // displayed set; the sheet has nothing to show then.
  const missing = target !== null && (!row || row.kind !== "data" || !table);
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  const fields = useMemo(
    () =>
      level && table
        ? buildRecordDetailFields({
            table,
            columns: level.schema.columns,
            columnMapper: session.columnMapper,
            lookups: session.lookups,
          })
        : [],
    [level, session, table],
  );

  const [editing, setEditing] = useState<FieldEditState | null>(null);
  const recordKey = target ? `${target.levelId}:${target.rowId}` : null;
  useEffect(() => {
    setEditing(null);
  }, [recordKey]);

  function saveField(field: RecordDetailField): void {
    if (!editing || !target || !level) return;
    const parsed = parseTablePatchValueDraft(field.meta.schema, editing.draft);
    if (!parsed.ok) {
      setEditing({ ...editing, issue: parsed.message });
      return;
    }
    try {
      level.writeCell(
        { rowId: target.rowId, colId: field.column.id },
        parsed.value,
      );
    } catch {
      setEditing({ ...editing, issue: "Could not save this field." });
      return;
    }
    setEditing(null);
  }

  const open = target !== null && !missing;
  const rowValues = row && row.kind === "data" ? row.columns : null;
  const tableLabel = table ? (table.label ?? table.name) : "";
  const title = rowValues ? recordDetailTitle(fields, rowValues) : null;

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-[8px] border-sap-border bg-sap-surface p-0"
        data-grid-part="record-detail-sheet"
      >
        <SheetHeader className="border-b border-sap-border-soft px-4 pb-3 pt-4 text-left">
          <SheetTitle className="text-[16px] leading-snug text-sap-fg">
            {title ?? tableLabel}
          </SheetTitle>
          <SheetDescription className="text-sap-muted">
            {title ? tableLabel : "Record details"}
          </SheetDescription>
        </SheetHeader>
        {rowValues && (
          <div className="flex flex-col pb-4" data-record-detail-fields>
            {fields.map((field) =>
              editing?.colId === field.column.id && field.form ? (
                <RecordFieldEditor
                  key={field.column.id}
                  field={field}
                  editing={editing}
                  onChange={(draft) =>
                    setEditing({ colId: field.column.id, draft })
                  }
                  onSave={() => saveField(field)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <RecordFieldLine
                  key={field.column.id}
                  field={field}
                  value={rowValues[field.column.id]}
                  lookup={
                    field.meta.displayType === "fk"
                      ? session.lookupForColumn(field.meta.schema)
                      : undefined
                  }
                  onEdit={
                    field.form
                      ? () => {
                          const form = field.form;
                          if (!form) return;
                          setEditing({
                            colId: field.column.id,
                            draft: recordFieldDraft(
                              form,
                              rowValues[field.column.id],
                            ),
                          });
                        }
                      : undefined
                  }
                />
              ),
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RecordFieldLine({
  field,
  value,
  lookup,
  onEdit,
}: {
  field: RecordDetailField;
  value: unknown;
  lookup?: LookupCapabilities;
  onEdit?: () => void;
}) {
  const content = (
    <>
      <div className="w-[7.25rem] shrink-0 pt-px text-[12px] font-medium leading-[1.5] text-sap-muted">
        {field.column.name}
      </div>
      <div
        className={cn(
          "min-w-0 flex-1 break-words text-[14px] leading-[1.45] text-sap-fg",
          isMonoRecordField(field.meta) && "mono",
        )}
      >
        {lookup ? (
          <LookupValueLabel lookup={lookup} value={value} />
        ) : (
          formatRecordFieldValue(field.meta, value)
        )}
      </div>
      {onEdit && (
        <ChevronRight
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0 text-sap-soft"
        />
      )}
    </>
  );

  if (!onEdit) {
    return (
      <div
        className="flex items-start gap-3 border-b border-sap-border-soft px-4 py-2.5"
        data-record-detail-field={field.column.id}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex w-full items-start gap-3 border-b border-sap-border-soft px-4 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sap-focus-ring"
      data-record-detail-field={field.column.id}
      aria-label={`Edit ${field.column.name}`}
      onClick={onEdit}
    >
      {content}
    </button>
  );
}

function RecordFieldEditor({
  field,
  editing,
  onChange,
  onSave,
  onCancel,
}: {
  field: RecordDetailField;
  editing: FieldEditState;
  onChange: (draft: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const form = field.form;
  if (!form) return null;
  return (
    <div
      className="flex flex-col gap-3 border-b border-sap-border-soft bg-sap-surface-muted/40 px-4 py-3"
      data-record-detail-field={field.column.id}
      data-record-detail-editing="true"
    >
      <FormField
        field={form}
        value={editing.draft}
        issue={editing.issue}
        onChange={onChange}
      />
      <div className="flex gap-2">
        <Button type="button" onClick={onSave}>
          Save
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function LookupValueLabel({
  lookup,
  value,
}: {
  lookup: LookupCapabilities;
  value: unknown;
}) {
  const label = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        lookup.valueLookup.subscribeToLookupChanges(listener),
      [lookup],
    ),
    () =>
      isLookupValue(value)
        ? (lookup.valueLookup.entryForValue(value)?.label ?? null)
        : null,
  );
  if (value === null || value === undefined || value === "") return null;
  return <>{label ?? String(value)}</>;
}

function useDisplayedRowOrNull(
  level: GridLevelRuntime | null,
  rowId: RowId | null,
): LevelRow | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!level || rowId === null) return () => {};
      try {
        return level.subscribeDisplayedRow(rowId, listener);
      } catch {
        return () => {};
      }
    },
    [level, rowId],
  );
  const getSnapshot = useCallback(() => {
    if (!level || rowId === null) return null;
    try {
      return level.displayedRow(rowId) ?? null;
    } catch {
      return null;
    }
  }, [level, rowId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
