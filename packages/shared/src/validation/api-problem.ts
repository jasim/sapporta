import { errorBodySchema, type ErrorBody } from "../contracts/error.js";
import { fieldIssueFromUnknown, type FieldIssue } from "./field-issues.js";

/** The structured, presentation-neutral parts of a Sapporta error body. */
export interface ApiProblem {
  summary: string;
  code?: string;
  fieldIssues: readonly FieldIssue[];
}

/** Parse a Sapporta ErrorBody and normalize its recognized field details. */
export function apiProblemFromBody(body: unknown): ApiProblem | undefined {
  const parsed = errorBodySchema.safeParse(body);
  if (!parsed.success) return undefined;

  return apiProblemFromErrorBody(parsed.data);
}

function apiProblemFromErrorBody(body: ErrorBody): ApiProblem {
  return {
    summary: body.error,
    ...(body.code !== undefined ? { code: body.code } : {}),
    fieldIssues: (body.details ?? []).flatMap((detail) => {
      const issue = fieldIssueFromUnknown(detail);
      return issue === undefined ? [] : [issue];
    }),
  };
}
