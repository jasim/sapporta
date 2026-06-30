/**
 * Thrown by Sapporta browser HTTP helpers when a route returns a non-2xx
 * status. Body is the parsed JSON the server sent, typically an ErrorBody.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}
