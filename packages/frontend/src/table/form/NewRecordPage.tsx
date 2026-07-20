import { useMemo, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { TableSchema } from "@sapporta/shared/contracts";
import { ApiError } from "@sapporta/shared/client";
import { TopBar, TopBarButton } from "../../shell/components/TopBar";
import { Button } from "@sapporta/ui/button";
import { FormField } from "./FormField";
import { parseCreateDraft } from "./parse-create-draft";
import {
  buildRecordFormFields,
  type RecordFormFieldModel,
} from "./record-form-fields";
import { createTableRow } from "../api/rows";
import { reloadTGridRows } from "../state/tgrid-session-registry";
import { useLookupStore } from "../../lookup";

export function NewRecordPage({ tableSchema }: { tableSchema: TableSchema }) {
  const navigate = useNavigate();
  const tableLabel = tableSchema.label ?? tableSchema.name;
  const tableUrl = `/tables/${tableSchema.name}`;
  const lookups = useLookupStore();
  const formFields = useMemo(
    () => buildRecordFormFields({ table: tableSchema, lookups }),
    [lookups, tableSchema],
  );
  const defaultValues = useMemo(
    () => initialValuesForFields(formFields),
    [formFields],
  );
  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: ({ value }) => createDraftErrors(tableSchema, value),
    },
    onSubmit: async ({ value, formApi }) => {
      const parsed = parseCreateDraft(tableSchema, value);
      if (!parsed.ok) return;

      try {
        await createTableRow(tableSchema.name, parsed.value);
        reloadTGridRows(tableSchema.name);
        navigate(tableUrl, { replace: true });
      } catch (error: unknown) {
        formApi.setErrorMap({
          onSubmit: { form: createErrorMessage(error), fields: {} },
        });
        throw error;
      }
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    form.setErrorMap({ onSubmit: undefined });
    void form.handleSubmit().catch(() => undefined);
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
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-[560px] flex-col gap-5"
        >
          <div className="flex flex-col gap-4">
            {formFields.map((fieldModel) => (
              <form.Field
                key={fieldModel.column.name}
                name={fieldModel.column.name}
              >
                {(field) => (
                  <FormField
                    field={fieldModel}
                    value={field.state.value}
                    issue={firstString(field.state.meta.errors)}
                    onChange={field.handleChange}
                  />
                )}
              </form.Field>
            ))}
          </div>

          <form.Subscribe
            selector={(state) =>
              [state.isSubmitting, state.errorMap.onSubmit] as const
            }
          >
            {([isSubmitting, serverError]) => {
              const serverErrorMessage = formErrorMessage(serverError);
              return (
                <>
                  {serverErrorMessage && (
                    <div className="text-sm text-sap-negative bg-sap-negative/10 rounded-[6px] p-3">
                      {serverErrorMessage}
                    </div>
                  )}

                  <div className="flex gap-2 border-t border-sap-border-soft pt-5">
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting && (
                        <Loader2
                          data-icon="inline-start"
                          className="animate-spin"
                        />
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
                </>
              );
            }}
          </form.Subscribe>
        </form>
      </div>
    </div>
  );
}

function initialValuesForFields(
  fields: readonly RecordFormFieldModel[],
): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.column.name, null]));
}

function createDraftErrors(
  tableSchema: TableSchema,
  value: Readonly<Record<string, unknown>>,
): { form?: string; fields: Record<string, string> } | undefined {
  const parsed = parseCreateDraft(tableSchema, value);
  if (parsed.ok) return undefined;
  return {
    fields: Object.fromEntries(
      parsed.issues.map((issue) => [issue.field, issue.message]),
    ),
  };
}

function firstString(errors: readonly unknown[]): string | undefined {
  return errors.find((error): error is string => typeof error === "string");
}

function formErrorMessage(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "form" in error) {
    const formError = error.form;
    return typeof formError === "string" ? formError : undefined;
  }
  return undefined;
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
