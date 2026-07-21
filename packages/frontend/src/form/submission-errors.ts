import { ApiError } from "@sapporta/shared/error";
import {
  apiProblemFromBody,
  type FieldIssue,
} from "@sapporta/shared/validation";

/** A submission failure whose issues can be rendered beside form fields. */
export class FormSubmissionError extends Error {
  readonly issues: readonly FieldIssue[];

  constructor(issues: readonly FieldIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "FormSubmissionError";
    this.issues = [...issues];
  }
}

/** Return field issues carried by local submission validation or an API body. */
export function fieldIssuesForSubmissionError(error: unknown): FieldIssue[] {
  if (error instanceof FormSubmissionError) return [...error.issues];
  if (!(error instanceof ApiError)) return [];

  return [...(apiProblemFromBody(error.body)?.fieldIssues ?? [])];
}

/** Normalize TanStack Form's first field error into displayable text. */
export function firstFormErrorMessage(
  errors: readonly unknown[],
): string | undefined {
  const firstError = errors[0];
  if (firstError === undefined) return undefined;
  if (typeof firstError === "string") return firstError;
  if (firstError instanceof Error) return firstError.message;
  if (
    firstError !== null &&
    typeof firstError === "object" &&
    "message" in firstError &&
    typeof firstError.message === "string"
  ) {
    return firstError.message;
  }
  return String(firstError);
}
