import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { TableSchema } from "@sapporta/shared/contracts";
import { ApiError } from "@sapporta/shared/client";
import { TopBar, TopBarButton } from "../../shell/components/TopBar";
import { Button } from "@sapporta/ui/button";
import { RecordFormField } from "./RecordFormField";
import { RecordFormProvider } from "./RecordFormProvider";
import { createRecordFormStore } from "./record-form-store";
import { parseCreateDraft } from "./parse-create-draft";
import { buildRecordFormFields } from "./record-form-fields";
import { createRecord } from "../actions/record-actions";
import { useLookupStore } from "../../lookup";

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
  const lookups = useLookupStore();
  const formFields = useMemo(
    () => buildRecordFormFields({ table: tableSchema, lookups }),
    [lookups, tableSchema],
  );

  useEffect(() => {
    setError(null);
  }, [tableSchema]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const parsed = parseCreateDraft(tableSchema, formStore.getState().values);
    if (!parsed.ok) {
      formStore.getState().setIssues(parsed.issues);
      return;
    }
    formStore.getState().setIssues([]);
    setSaving(true);

    try {
      await createRecord(tableSchema.name, parsed.value);
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
            className="flex w-full max-w-[560px] flex-col gap-5"
          >
            <div className="flex flex-col gap-4">
              {formFields.map((field) => (
                <RecordFormField key={field.column.name} field={field} />
              ))}
            </div>

            {error && (
              <div className="text-sm text-sap-negative bg-sap-negative/10 rounded-[6px] p-3">
                {error}
              </div>
            )}

            <div className="flex gap-2 border-t border-sap-border-soft pt-5">
              <Button type="submit" disabled={saving}>
                {saving && (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                )}
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
