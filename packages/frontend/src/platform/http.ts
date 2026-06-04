import { ApiError } from "@sapporta/shared/client";
import { getApiBase } from "./base";

export { ApiError };

export async function fetchApi(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(`${getApiBase()}${path}`, {
    credentials: "include",
    ...init,
  });
  if (response.ok) return response;
  throw new ApiError(response.status, await parseErrorBody(response));
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
