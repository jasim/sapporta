/**
 * HTTP client used by API-backed CLI commands.
 *
 * The caller supplies an `ApiTarget`: the deployment URL, the token when one
 * is available, and which setting chose each. When a token is present it is
 * sent as `Authorization: Bearer ...`. When it is absent the request stays
 * anonymous, so public endpoints can still be called and protected endpoints
 * return the server's structured auth error.
 *
 * Every CLI request passes through here, so this module also decides what an
 * API failure means. It returns the response payload or throws an
 * `ApiRequestError`; no caller ever sees a status code.
 */
import { isFetchNetworkError } from "@sapporta/shared/client";
import { ErrorCode, OperationError } from "../errors.js";
import type { ApiTarget } from "./runtime-config.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequestOptions {
  body?: unknown;
  queryParams?: Record<string, string>;
}

const NON_JSON_BODY_LIMIT = 500;

/**
 * Error codes that mean the deployment does not recognise the caller at all.
 *
 * Every Sapporta deployment answers a token issued by a different one exactly
 * this way, so the failure does not establish which server was reached.
 * `token_expired`, `token_revoked`, and `workspace_required` are deliberately
 * absent: each requires the server to have found the token in its own
 * database, which proves the request arrived where it was aimed.
 */
const UNRECOGNIZED_CALLER_CODES = new Set(["unauthenticated"]);

/**
 * A failed API call, carrying the deployment it was aimed at.
 *
 * `targetConfirmed` records whether the app answered as itself. A domain code
 * such as `TABLE_NOT_FOUND` is proof of arrival — only a Sapporta app knows
 * what it means — so the target is settled and reporting it would be noise. A
 * body that is not a Sapporta error envelope, or one that says the caller is
 * unknown, leaves the target an open question worth surfacing.
 */
export class ApiRequestError extends OperationError {
  readonly target: ApiTarget;
  readonly requestUrl: string;
  readonly targetConfirmed: boolean;

  constructor(options: {
    message: string;
    code: string;
    target: ApiTarget;
    requestUrl: string;
    targetConfirmed: boolean;
  }) {
    super(options.message, options.code);
    this.name = "ApiRequestError";
    this.target = options.target;
    this.requestUrl = options.requestUrl;
    this.targetConfirmed = options.targetConfirmed;
  }
}

export async function httpRequest(
  target: ApiTarget,
  method: HttpMethod,
  path: string,
  opts: HttpRequestOptions = {},
): Promise<unknown> {
  const url = requestUrl(target.apiUrl, path, opts.queryParams);

  let res: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (target.apiToken) {
      headers.Authorization = `Bearer ${target.apiToken}`;
    }

    res = await fetch(url, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (err: unknown) {
    if (isFetchNetworkError(err)) {
      throw new ApiRequestError({
        message: [
          "Unable to reach the Sapporta app server.",
          "Check that the server is running and that this process has permission to make network requests.",
          "In sandboxed coding-agent environments, rerun with network permissions enabled.",
        ].join(" "),
        code: ErrorCode.APP_SERVER_UNREACHABLE,
        target,
        requestUrl: url.toString(),
        targetConfirmed: false,
      });
    }
    throw err;
  }

  const succeeded = res.status >= 200 && res.status < 300;
  const text = await res.text();
  if (text === "") {
    if (succeeded) return {};
    throw responseError(res.status, {}, target, url.toString());
  }

  // The only parse of the body. Its failure is itself the diagnosis: a reply
  // that is not JSON did not come from a Sapporta API route, whatever status
  // it carries. A 200 of HTML from a dev server on a neighbouring port is the
  // common case, so this stays a failure rather than a payload.
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiRequestError({
      message: `The server did not return JSON (HTTP ${res.status}): ${truncate(text)}`,
      code: ErrorCode.NON_JSON_RESPONSE,
      target,
      requestUrl: url.toString(),
      targetConfirmed: false,
    });
  }

  if (succeeded) return data;
  throw responseError(res.status, data, target, url.toString());
}

function requestUrl(
  baseUrl: string,
  path: string,
  queryParams: Record<string, string> | undefined,
): URL {
  // Keep any path prefix in the deployment URL, such as
  // https://host/apps/acme/. A leading slash would make URL resolution discard
  // that prefix and call the wrong deployment.
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(
    relativePath,
    baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
  );
  for (const [key, value] of Object.entries(queryParams ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url;
}

function responseError(
  status: number,
  data: unknown,
  target: ApiTarget,
  requestUrl: string,
): ApiRequestError {
  const body = readErrorBody(data);
  return new ApiRequestError({
    message: body.error ?? `HTTP ${status}`,
    code: body.code ?? `HTTP_${status}`,
    target,
    requestUrl,
    targetConfirmed:
      body.code !== undefined && !UNRECOGNIZED_CALLER_CODES.has(body.code),
  });
}

function readErrorBody(data: unknown): { error?: string; code?: string } {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {};
  }
  const record = data as Record<string, unknown>;
  return {
    ...(typeof record.error === "string" ? { error: record.error } : {}),
    ...(typeof record.code === "string" ? { code: record.code } : {}),
  };
}

function truncate(text: string): string {
  return text.length > NON_JSON_BODY_LIMIT
    ? text.slice(0, NON_JSON_BODY_LIMIT) + "…"
    : text;
}
