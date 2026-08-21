import { useMemo, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import type { TableSchema } from "@sapporta/shared/contracts";
import { ApiError } from "@sapporta/shared/client";
import { apiProblemFromBody } from "@sapporta/shared/validation";
import {
  PageHeader,
  PageHeaderButton,
} from "../../shell/components/PageHeader";
import { PageBody, PageFrame } from "../../shell/components/Page";
import { Button } from "@sapporta/ui/button";
import {
  fieldIssuesForSubmissionError,
  firstFormErrorMessage,
} from "../../form";
import { FormField } from "./FormField";
import { parseCreateDraft } from "./parse-create-draft";
import {
  buildRecordFormFields,
  type RecordFormFieldModel,
} from "./record-form-fields";
import { createTableRow } from "../api/rows";
import { tableQueryKeys } from "../query";
import { reloadTGridRows } from "../tgrid/tgrid-session-registry";
import { useLookupStore } from "../../lookup";

export function NewRecordPage({ tableSchema }: { tableSchema: TableSchema }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
        await queryClient.invalidateQueries({
          queryKey: tableQueryKeys.table(tableSchema.name),
        });
        navigate(tableUrl, { replace: true });
      } catch (error: unknown) {
        const fieldIssues = fieldIssuesForSubmissionError(error);
        formApi.setErrorMap({
          onSubmit: {
            form: createErrorMessage(error),
            fields: Object.fromEntries(
              fieldIssues.map((issue) => [issue.field, issue.message]),
            ),
          },
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
    <PageFrame>
      <PageHeader
        section={`Tables / ${tableLabel}`}
        title="New record"
        actions={
          <PageHeaderButton
            tone="ghost"
            onClick={() => navigate(tableUrl)}
            icon={<ArrowLeft className="h-[12px] w-[12px]" />}
          >
            Table
          </PageHeaderButton>
        }
      />

      <PageBody className="px-5 py-6">
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
                    issue={firstFormErrorMessage(field.state.meta.errors)}
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
      </PageBody>
    </PageFrame>
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
  return apiProblemFromBody(err.body)?.summary ?? "Could not save this record.";
}
