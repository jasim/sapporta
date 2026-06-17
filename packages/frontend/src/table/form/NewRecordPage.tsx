import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { TableSchema } from "@sapporta/shared/contracts";
import { ApiError } from "@sapporta/shared/client";
import type { LookupCapabilities } from "@sapporta/grid/lookup";
import { TopBar, TopBarButton } from "@/shell/components/TopBar";
import { Button } from "@sapporta/ui";
import { RecordFormField } from "@/table/form/RecordFormField";
import { RecordFormProvider } from "@/table/form/RecordFormProvider";
import {
  compactRecordFormValues,
  createRecordFormStore,
} from "@/table/form/record-form-store";
import { isRecordFormEditableColumn } from "@/table/form/field-policy";
import { createRecord } from "@/table/actions/record-actions";
import { createTableLookupRegistry } from "@/table/lookup/table-lookup-registry";
import { createColumnLookupResolver } from "@/table/lookup/column-lookup";

export function NewRecordPage({ tableSchema }: { tableSchema: TableSchema }) {
  const navigate = useNavigate();
  const tableLabel = tableSchema.label ?? tableSchema.name;
  const tableUrl = `/tables/${tableSchema.name}`;
  const formStore = useMemo(
    () => createRecordFormStore(tableSchema),
    [tableSchema],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lookupRegistry = useMemo(
    () => createTableLookupRegistry(),
    [tableSchema],
  );
  const lookupResolver = useMemo(
    () => createColumnLookupResolver(lookupRegistry),
    [lookupRegistry],
  );
  const lookupsByColumn = useMemo(() => {
    const lookups = new Map<string, LookupCapabilities>();
    for (const col of tableSchema.columns) {
      if (!isRecordFormEditableColumn(col) || !col.foreignKey) continue;
      const lookup = lookupResolver.lookupForColumn({
        tableName: tableSchema.name,
        column: col,
      });
      if (lookup) lookups.set(col.name, lookup);
    }
    return lookups;
  }, [lookupResolver, tableSchema]);

  useEffect(() => {
    setError(null);
  }, [tableSchema]);

  useEffect(() => () => lookupRegistry.dispose(), [lookupRegistry]);

  const formColumns = useMemo(
    () => tableSchema.columns.filter(isRecordFormEditableColumn),
    [tableSchema],
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await createRecord(
        tableSchema.name,
        compactRecordFormValues(formStore.getState().values),
      );
    } catch (err: unknown) {
      setError(createErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-sap-surface">
      <TopBar
        section={`Tables / ${tableLabel}`}
        title="New record"
        actions={
          <TopBarButton
            tone="ghost"
            onClick={() => navigate(tableUrl)}
            icon={<ArrowLeft className="h-[12px] w-[12px]" />}
          >
            Table
          </TopBarButton>
        }
      />

      <div className="flex-1 overflow-auto px-5 py-6">
        <RecordFormProvider store={formStore}>
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-[560px] space-y-5"
          >
            <div className="space-y-4">
              {formColumns.map((col) => (
                <RecordFormField
                  key={col.name}
                  column={col}
                  lookup={lookupsByColumn.get(col.name)}
                />
              ))}
            </div>

            {error && (
              <div className="text-sm text-sap-negative bg-sap-negative/10 rounded-[6px] p-3">
                {error}
              </div>
            )}

            <div className="flex gap-2 border-t border-sap-border-soft pt-5">
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Create
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(tableUrl)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </RecordFormProvider>
      </div>
    </div>
  );
}

function createErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Could not save this record.";
  const body = err.body;
  if (!body || typeof body !== "object") return "Could not save this record.";

  const details = "details" in body ? body.details : undefined;
  if (Array.isArray(details)) {
    const messages = details.flatMap((detail) => {
      if (!detail || typeof detail !== "object") return [];
      const field = "field" in detail ? detail.field : undefined;
      const message = "message" in detail ? detail.message : undefined;
      if (typeof field !== "string" || typeof message !== "string") return [];
      return [`${field}: ${message}`];
    });
    if (messages.length > 0) return messages.join(", ");
  }

  const error = "error" in body ? body.error : undefined;
  return typeof error === "string" ? error : "Could not save this record.";
}
