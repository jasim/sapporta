import { z } from "zod";

/**
 * Wire shape of the error envelope every Sapporta API returns for 4xx/5xx
 * responses. Used by every contract's non-2xx response declaration and
 * thrown by `createApiClient` as the body of `ApiError`.
 */
export const errorBodySchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    details: z.array(z.unknown()).optional(),
  })
  .meta({ id: "ErrorBody" });

export type ErrorBody = z.output<typeof errorBodySchema>;

/**
 * Thrown by the typed client wrapper when a route returns a non-2xx
 * status. Body is the parsed JSON the server sent — typically an
 * `ErrorBody`, but the client preserves whatever shape arrived so
 * callers can introspect.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}
