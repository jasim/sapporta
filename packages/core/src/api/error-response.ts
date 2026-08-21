import type { Context, Env } from "hono";
import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status";
import {
  ErrorCode,
  OperationError,
  type ClassifiedSqliteError,
  type ErrorCodeValue,
} from "../errors.js";
import type { OperationResult } from "../introspect/operation-result.js";
import { ERROR_CODE_STATUS } from "./error-codes.js";

export type HttpErrorStatus = ClientErrorStatusCode | ServerErrorStatusCode;

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: readonly unknown[];
}

export interface ApiErrorOptions extends ApiErrorBody {
  status?: HttpErrorStatus;
}

export function statusForCode(code: string): HttpErrorStatus {
  return (ERROR_CODE_STATUS[code as ErrorCodeValue] ?? 500) as HttpErrorStatus;
}

export function errorBody(options: ApiErrorOptions): ApiErrorBody {
  return {
    error: options.error,
    ...(options.code !== undefined ? { code: options.code } : {}),
    ...(options.details !== undefined ? { details: options.details } : {}),
  };
}

export function jsonErrorResponse(options: ApiErrorOptions): Response {
  return Response.json(errorBody(options), {
    status: options.status ?? statusForCode(options.code ?? ErrorCode.INTERNAL),
  });
}

export function apiErrorResponse<E extends Env>(
  c: Context<E>,
  options: ApiErrorOptions,
): Response {
  return c.json(
    errorBody(options),
    options.status ?? statusForCode(options.code ?? ErrorCode.INTERNAL),
  );
}

export function operationErrorResponse<E extends Env>(
  c: Context<E>,
  err: OperationError,
): Response {
  return apiErrorResponse(c, {
    error: err.message,
    code: err.code,
  });
}

export function operationResultResponse<E extends Env>(
  c: Context<E>,
  result: OperationResult,
): Response {
  if (result.ok) return c.json(result.data);
  return apiErrorResponse(c, {
    error: result.error,
    code: result.code,
  });
}

export function classifiedSqliteErrorResponse<E extends Env>(
  c: Context<E>,
  err: ClassifiedSqliteError,
): Response {
  return apiErrorResponse(c, {
    error: publicSqliteErrorMessage(err),
    code: err.code,
    status: err.status,
  });
}

export function publicSqliteErrorMessage(err: ClassifiedSqliteError): string {
  return err.status === 500 ? "Database operation failed" : err.message;
}

export function isKnownErrorCode(code: string): code is ErrorCodeValue {
  return Object.values(ErrorCode).includes(code as ErrorCodeValue);
}
