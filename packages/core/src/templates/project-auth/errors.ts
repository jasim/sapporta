import type { ErrorBody } from "@sapporta/shared/contracts";

export const projectAuthErrorCodes = [
  "unauthenticated",
  "email_not_verified",
  "workspace_required",
  "forbidden",
  "not_found",
  "validation_failed",
] as const;

export type ProjectAuthErrorCode = (typeof projectAuthErrorCodes)[number];

export type ProjectAuthErrorStatus = 400 | 401 | 403 | 404 | 422;

const AUTH_ERROR_STATUS: Record<ProjectAuthErrorCode, ProjectAuthErrorStatus> = {
  unauthenticated: 401,
  email_not_verified: 403,
  workspace_required: 403,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
};

const AUTH_ERROR_MESSAGES: Record<ProjectAuthErrorCode, string> = {
  unauthenticated: "Authentication required",
  email_not_verified: "Email verification required",
  workspace_required: "Active workspace required",
  forbidden: "Forbidden",
  not_found: "Not found",
  validation_failed: "Validation failed",
};

export interface ProjectAuthErrorBody extends ErrorBody {
  code: ProjectAuthErrorCode;
}

export interface ProjectAuthFailure {
  status: ProjectAuthErrorStatus;
  body: ProjectAuthErrorBody;
}

export function authErrorStatus(code: ProjectAuthErrorCode): ProjectAuthErrorStatus {
  return AUTH_ERROR_STATUS[code];
}

export function authErrorBody(
  code: ProjectAuthErrorCode,
  message = AUTH_ERROR_MESSAGES[code],
  details?: readonly unknown[],
): ProjectAuthErrorBody {
  return {
    error: message,
    code,
    ...(details === undefined ? {} : { details: [...details] }),
  };
}

export function authFailure(
  code: ProjectAuthErrorCode,
  message?: string,
  details?: readonly unknown[],
): ProjectAuthFailure {
  return {
    status: authErrorStatus(code),
    body: authErrorBody(code, message, details),
  };
}
