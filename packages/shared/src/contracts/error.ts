import { z } from "zod";
export { ApiError } from "../error.js";

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
