const FETCH_NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
]);

const FETCH_NETWORK_ERROR_MESSAGES = new Set([
  "fetch failed",
  "Failed to fetch",
  "Load failed",
  "NetworkError when attempting to fetch resource.",
]);

/**
 * Returns true when `fetch()` failed before receiving an HTTP response.
 *
 * This classifies transport-level failures only. HTTP 4xx/5xx responses are
 * still successful fetches and should be handled from their response body.
 */
export function isFetchNetworkError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;

  const record = err as {
    code?: unknown;
    cause?: { code?: unknown } | null;
    message?: unknown;
    name?: unknown;
  };
  const code =
    typeof record.code === "string"
      ? record.code
      : typeof record.cause?.code === "string"
        ? record.cause.code
        : undefined;

  if (code && FETCH_NETWORK_ERROR_CODES.has(code)) return true;

  if (record.name !== "TypeError" || typeof record.message !== "string") {
    return false;
  }

  return FETCH_NETWORK_ERROR_MESSAGES.has(record.message);
}
