import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Turns an explicit authorization result into a 403 response.
 *
 * Callers should compute CASL checks directly and pass the boolean here. This
 * helper intentionally does not accept callbacks, so dependency failures and
 * programming errors are not mistaken for ordinary "not allowed" answers.
 */
export function forbidUnless(c: Context, allowed: boolean): void {
  if (allowed) return;
  throw new HTTPException(403, {
    res: c.json({ error: "Forbidden", code: "forbidden" }, 403),
  });
}
