import { ApiError } from "@sapporta/shared/error";
import { getApiBase } from "./base";

export { ApiError };

export async function fetchApi(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${getApiBase()}${path}`, {
    credentials: "include",
    method: init?.method ?? "GET",
    ...init,
  });
  if (response.ok) return response;
  throw new ApiError(response.status, await parseErrorBody(response));
}

export async function fetchApiJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetchApi(path, init);
  return (await response.json()) as T;
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, init);
  if (response.ok) return (await response.json()) as T;
  throw new ApiError(response.status, await parseErrorBody(response));
}

export async function parseErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { error: response.statusText };
  }
}

export function errorMessage(
  err: unknown,
  fallback = "Request failed",
): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (isErrorBody(body)) return body.error;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

function isErrorBody(body: unknown): body is { error: string } {
  return (
    body !== null &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  );
}
