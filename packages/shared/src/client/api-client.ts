/**
 * Typed HTTP client built on `@sapporta/rest-core::initClient`.
 *
 * Two pieces:
 *
 *   1. `createApiClient(contract, { baseUrl })` — wraps each route method
 *      in a Proxy that returns the 2xx body on success and throws
 *      `ApiError(status, body)` on non-2xx. The dispatcher pattern across
 *      Sapporta UI is exception-shaped (try/catch → format), so the
 *      throwing surface is what every caller wants.
 *
 *   2. `ThrowingClient<T>` — type that flattens each route's
 *      `Promise<{ status, body }>` into `Promise<body>` for the 2xx
 *      branch, recursively across nested routers.
 *
 * `baseUrl` is taken as a getter (not a string) so a host can resolve
 * it at call time without forcing client re-creation.
 */

import {
  initClient,
  tsRestFetchApi,
  type AppRoute,
  type AppRouter,
  type ApiFetcher,
  type ClientInferResponses,
  type ClientInferResponseBody,
  type InitClientArgs,
  type InitClientReturn,
  type PartialClientInferRequest,
} from "@sapporta/rest-core";
import { ApiError } from "../contracts/error.js";

type SuccessStatus = 200 | 201 | 202 | 204;

type SuccessKey<TRoute extends AppRoute> = keyof TRoute["responses"] &
  SuccessStatus;

/** The body of any 2xx response declared by the route. Resolves only the
 *  success keys actually declared on the route — `ClientInferResponseBody`
 *  rejects status codes that aren't keys of `responses`. */
type SuccessBody<TRoute extends AppRoute> =
  SuccessKey<TRoute> extends never
    ? never
    : ClientInferResponseBody<TRoute, SuccessKey<TRoute>>;

/** Are all keys of T optional? Mirrors ts-rest's internal helper so we
 *  can keep the args-optional vs args-required call signature exactly
 *  matching the underlying client. */
type AreAllPropertiesOptional<T> = keyof T extends never
  ? true
  : Partial<T> extends T
    ? true
    : false;

/** Throwing twin of a single ts-rest route function: returns the success
 *  body directly, throws `ApiError` on non-2xx. */
type ThrowingRouteFn<TRoute extends AppRoute> =
  AreAllPropertiesOptional<
    PartialClientInferRequest<TRoute, InitClientArgs>
  > extends true
    ? (
        args?: PartialClientInferRequest<TRoute, InitClientArgs>,
      ) => Promise<SuccessBody<TRoute>>
    : (
        args: PartialClientInferRequest<TRoute, InitClientArgs>,
      ) => Promise<SuccessBody<TRoute>>;

export type ThrowingClient<T extends AppRouter> = {
  [K in keyof T]: T[K] extends AppRoute
    ? ThrowingRouteFn<T[K]>
    : T[K] extends AppRouter
      ? ThrowingClient<T[K]>
      : never;
};

export interface CreateApiClientOptions {
  /** Called before every fetch — returned value is prepended to each
   *  route's path. A getter (not a string) so a host can resolve it at
   *  call time without forcing client re-creation. */
  baseUrl: () => string;
  baseHeaders?: Record<string, string>;
  /** Passed through to fetch for every request. Use "include" when the
   *  API authenticates with cross-origin cookies. */
  credentials?: InitClientArgs["credentials"];
  /** Run zod validation on response bodies before returning. Default
   *  true — contracts are tight enough that failures indicate
   *  contract/runtime drift worth surfacing. */
  validateResponse?: boolean;
}

function unwrapResponse(response: { status: number; body: unknown }): unknown {
  if (response.status >= 200 && response.status < 300) return response.body;
  throw new ApiError(response.status, response.body);
}

function wrapThrowing<T extends AppRouter>(
  raw: InitClientReturn<T, InitClientArgs>,
): ThrowingClient<T> {
  return new Proxy(raw as object, {
    get(target, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      if (typeof value === "function") {
        return async (...args: unknown[]) => {
          const response = await (
            value as (...a: unknown[]) => Promise<unknown>
          ).apply(target, args);
          return unwrapResponse(response as { status: number; body: unknown });
        };
      }
      if (value && typeof value === "object") {
        return wrapThrowing(
          value as InitClientReturn<AppRouter, InitClientArgs>,
        );
      }
      return value;
    },
  }) as ThrowingClient<T>;
}

export function createApiClient<T extends AppRouter>(
  contract: T,
  options: CreateApiClientOptions,
): ThrowingClient<T> {
  const dynamicBaseFetcher: ApiFetcher = (args) =>
    tsRestFetchApi({ ...args, path: options.baseUrl() + args.path });

  const raw = initClient(contract, {
    baseUrl: "",
    baseHeaders: options.baseHeaders ?? { "Content-Type": "application/json" },
    credentials: options.credentials,
    api: dynamicBaseFetcher,
    validateResponse: options.validateResponse ?? true,
  });

  return wrapThrowing(raw);
}

export { ApiError } from "../contracts/error.js";
export type { ClientInferResponses };
