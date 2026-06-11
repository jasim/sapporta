import { HTTPException } from "hono/http-exception";
import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status";

export type HttpExceptionStatus = ClientErrorStatusCode | ServerErrorStatusCode;

export type NormalizedHttpException = {
  status: HttpExceptionStatus;
  message: string;
  response?: Response;
};

type ForeignHonoHttpException = Error & {
  status: HttpExceptionStatus;
  res?: Response;
  getResponse: () => Response;
};

export function normalizeHttpException(
  err: unknown,
): NormalizedHttpException | null {
  if (err instanceof HTTPException) {
    const status = httpExceptionStatusFromNumber(err.status);
    return {
      status,
      message: err.message,
      response: err.res ? responseFromHonoException(err) : undefined,
    };
  }

  const foreignException = foreignHonoHttpException(err);
  if (!foreignException) return null;

  if (foreignException.res) {
    const response = responseFromHonoException(foreignException);
    return {
      status: foreignException.status,
      message: foreignException.message,
      response,
    };
  }

  return {
    status: foreignException.status,
    message: foreignException.message,
  };
}

function foreignHonoHttpException(
  err: unknown,
): ForeignHonoHttpException | null {
  if (!(err instanceof Error)) return null;

  const candidate = err as {
    status?: unknown;
    res?: unknown;
    getResponse?: unknown;
  };
  if (
    !isHttpExceptionStatus(candidate.status) ||
    typeof candidate.getResponse !== "function"
  ) {
    return null;
  }
  if (candidate.res !== undefined && !(candidate.res instanceof Response)) {
    return null;
  }

  return err as ForeignHonoHttpException;
}

function responseFromHonoException(err: {
  getResponse: () => Response;
}): Response | undefined {
  try {
    const response = err.getResponse();
    if (
      !(response instanceof Response) ||
      !isHttpExceptionStatus(response.status)
    ) {
      return undefined;
    }
    return response;
  } catch {
    return undefined;
  }
}

function httpExceptionStatusFromNumber(status: number): HttpExceptionStatus {
  return isHttpExceptionStatus(status) ? status : 500;
}

function isHttpExceptionStatus(status: unknown): status is HttpExceptionStatus {
  return (
    status === 400 ||
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 404 ||
    status === 405 ||
    status === 406 ||
    status === 407 ||
    status === 408 ||
    status === 409 ||
    status === 410 ||
    status === 411 ||
    status === 412 ||
    status === 413 ||
    status === 414 ||
    status === 415 ||
    status === 416 ||
    status === 417 ||
    status === 418 ||
    status === 421 ||
    status === 422 ||
    status === 423 ||
    status === 424 ||
    status === 425 ||
    status === 426 ||
    status === 428 ||
    status === 429 ||
    status === 431 ||
    status === 451 ||
    status === 500 ||
    status === 501 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 505 ||
    status === 506 ||
    status === 507 ||
    status === 508 ||
    status === 510 ||
    status === 511
  );
}
