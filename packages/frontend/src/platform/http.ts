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
    const message = apiErrorMessage(err.body);
    if (message) return message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

function apiErrorMessage(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const error = "error" in body ? body.error : undefined;
  if (typeof error === "string") return error;
  const message = "message" in body ? body.message : undefined;
  return typeof message === "string" ? message : undefined;
}
