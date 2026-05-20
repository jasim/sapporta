import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { TableSchema } from "@sapporta/shared/contracts";
import { ApiError } from "@sapporta/shared/client";
import { TopBar, TopBarButton } from "@/shell/components/TopBar";
import { Button } from "@/ui/primitives/button";
import { RecordFormField } from "@/table/form/RecordFormField";
import { RecordFormProvider } from "@/table/form/RecordFormProvider";
import {
  compactRecordFormValues,
  createRecordFormStore,
} from "@/table/form/record-form-store";
import { createRecord } from "@/table/actions/record-actions";
import { fetchLookupEntriesForSearch } from "@/lookup/api/lookup";
import type { FkOptionsMap } from "@/lookup/types";

const EMPTY_FK_OPTIONS: FkOptionsMap = {};

export function NewRecordPage({ tableSchema }: { tableSchema: TableSchema }) {
  const navigate = useNavigate();
  const tableLabel = tableSchema.label ?? tableSchema.name;
  const tableUrl = `/tables/${tableSchema.name}`;
  const formStore = useMemo(
    () => createRecordFormStore(tableSchema),
    [tableSchema],
  );
  const [fkOptions, setFkOptions] = useState<FkOptionsMap>(EMPTY_FK_OPTIONS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [tableSchema]);

  useEffect(() => {
    const fkColumns = tableSchema.columns.filter((c) => c.foreignKey != null);
    if (fkColumns.length === 0) {
      setFkOptions(EMPTY_FK_OPTIONS);
      return;
    }

    let cancelled = false;
    Promise.all(
      fkColumns.map(async (col) => {
        const fk = col.foreignKey;
        if (fk == null) return null;
        try {
          const res = await fetchLookupEntriesForSearch({
            tableName: fk.table,
            searchText: "",
            limit: 5000,
          });
          return {
            columnName: col.name,
            values: Object.fromEntries(
              res.entries.map((entry) => [String(entry.value), entry.label]),
            ),
          };
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: FkOptionsMap = {};
      for (const entry of entries) {
        if (entry) next[entry.columnName] = entry.values;
      }
      setFkOptions(next);
    });

    return () => {
      cancelled = true;
    };
  }, [tableSchema]);

  const formColumns = useMemo(
    () =>
      tableSchema.columns.filter((col) => {
        if (col.visuallyHidden) return false;
        if (col.primary && col.hasDefault) return false;
        return true;
      }),
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
        title="New Record"
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
                  fkOptions={fkOptions[col.name]}
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
  if (!(err instanceof ApiError)) return "Failed to save";
  const body = err.body;
  if (!body || typeof body !== "object") return "Failed to save";

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
  return typeof error === "string" ? error : "Failed to save";
}
