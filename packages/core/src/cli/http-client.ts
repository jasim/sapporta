/**
 * HTTP client used by API-backed CLI commands.
 *
 * The caller supplies the deployment URL and, when available, a workspace
 * token. When a token is present it is sent as `Authorization: Bearer ...` on
 * the request. When it is absent the request stays anonymous, so public
 * endpoints can still be called and protected endpoints return the server's
 * structured auth error.
 */

export interface HttpResult {
  status: number;
  data: unknown;
}

export interface HttpRequestOptions {
  body?: unknown;
  queryParams?: Record<string, string>;
  authToken?: string;
}

export async function httpRequest(
  baseUrl: string,
  method: string,
  path: string,
  opts: HttpRequestOptions = {},
): Promise<HttpResult> {
  // Keep any path prefix in the deployment URL, such as
  // https://host/apps/acme/. A leading slash would make URL resolution discard
  // that prefix and call the wrong deployment.
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(
    relativePath,
    baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
  );
  if (opts?.queryParams) {
    for (const [k, v] of Object.entries(opts.queryParams)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  let res: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.authToken) {
      headers.Authorization = `Bearer ${opts.authToken}`;
    }

    res = await fetch(url, {
      method,
      headers,
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
