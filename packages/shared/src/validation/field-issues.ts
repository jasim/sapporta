import type { ZodError } from "zod";

/** A validation issue associated with one form or request field. */
export interface FieldIssue {
  field: string;
  message: string;
}

/** Convert Zod issues without discarding nested field paths. */
export function fieldIssuesFromZodError(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    field: fieldFromIssuePath(issue.path),
    message: issue.message,
  }));
}

export function fieldIssueFromUnknown(value: unknown): FieldIssue | undefined {
  if (value === null || typeof value !== "object") return undefined;

  const message = "message" in value ? value.message : undefined;
  if (typeof message !== "string") return undefined;

  const field = "field" in value ? value.field : undefined;
  if (typeof field === "string") return { field, message };

  const path = "path" in value ? value.path : undefined;
  if (!Array.isArray(path) || !path.every(isPropertyKey)) return undefined;
  return { field: fieldFromIssuePath(path), message };
}

function fieldFromIssuePath(path: readonly PropertyKey[]): string {
  return path.length > 0 ? path.map(String).join(".") : "form";
}

function isPropertyKey(value: unknown): value is PropertyKey {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "symbol"
  );
}
