/**
 * Minimal HTTP client for the CLI → API bridge.
 *
 * All CLI commands that touch data go through this function.
 * The server runs at SAPPORTA_API_URL (default http://localhost:3000).
 */

export interface HttpResult {
  status: number;
  data: any;
}

export async function httpRequest(
  baseUrl: string,
  method: string,
  path: string,
  opts?: {
    body?: unknown;
    queryParams?: Record<string, string>;
  },
): Promise<HttpResult> {
  // Strip leading "/" so new URL() treats the path as relative to baseUrl's path.
  // With a leading slash, new URL("/api/meta/tables", "http://host/p/playground/")
  // discards the base path → "http://host/api/meta/tables" (broken).
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(relativePath, baseUrl.endsWith("/") ? baseUrl : baseUrl + "/");
  if (opts?.queryParams) {
    for (const [k, v] of Object.entries(opts.queryParams)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (err: any) {
    if (err.code === "ECONNREFUSED" || err.cause?.code === "ECONNREFUSED") {
      throw new Error(
        `Cannot connect to Sapporta server at ${baseUrl}. Is the server running?`,
      );
    }
    throw err;
  }

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const snippet = text.length > 500 ? text.slice(0, 500) + "…" : text;
      data = {
        ok: false,
        error: snippet,
        code: "NON_JSON_RESPONSE",
      };
    }
  }
  return { status: res.status, data };
}
