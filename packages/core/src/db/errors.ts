export class ValidationError extends Error {
  public readonly errors: Array<{ field: string; message: string }>;

  constructor(errors: Array<{ field: string; message: string }>) {
    const msg = errors.map((e) => `${e.field}: ${e.message}`).join(", ");
    super(`Validation failed: ${msg}`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export class ActionError extends Error {
  public readonly code: string;

  constructor(message: string, code = "ACTION_ERROR") {
    super(message);
    this.name = "ActionError";
    this.code = code;
  }
}

/** Closed taxonomy of parseQuery() failures. Every code maps to HTTP 400 at
 *  the CRUD handler — silent-ignore is rejected as a class, so typos and
 *  malformed query strings surface as client errors rather than returning
 *  "all rows". */
export type QueryParseErrorCode =
  | "unknown_filter_shape"
  | "unknown_column"
  | "unknown_op"
  | "bad_value"
  | "op_not_applicable"
  | "bad_limit"
  | "bad_page"
  | "no_search_config"
  | "unknown_search_column";

export class QueryParseError extends Error {
  public readonly code: QueryParseErrorCode;

  constructor(code: QueryParseErrorCode, message: string) {
    super(message);
    this.name = "QueryParseError";
    this.code = code;
  }
}
