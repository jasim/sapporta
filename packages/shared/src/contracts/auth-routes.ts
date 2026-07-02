import { initContract } from "@sapporta/rest-core";
import { z } from "zod";
import { errorBodySchema } from "./error.js";
import {
  authTokenListResponseSchema,
  authBootstrapStatusSchema,
  authContextResponseSchema,
  createAuthTokenBodySchema,
  createAuthTokenResponseSchema,
  switchActiveWorkspaceBodySchema,
} from "./auth-schema.js";

const c = initContract();

/**
 * Auth endpoints used by the app UI.
 *
 * Browser-authenticated users manage workspaces and agent access tokens here.
 * Agent tokens are for calling ordinary app APIs; they are not accepted for
 * creating, listing, or revoking other tokens.
 */
export const getAuthContextRoute = c.query({
  method: "GET",
  path: "/auth-context",
  summary: "Read the current Sapporta auth context",
  metadata: { tags: ["auth"] },
  responses: {
    200: authContextResponseSchema,
    401: errorBodySchema,
    403: errorBodySchema,
  },
});

export const getAuthBootstrapStatusRoute = c.query({
  method: "GET",
  path: "/auth-bootstrap",
  summary: "Read whether the browser should show sign-up",
  metadata: { tags: ["auth"], openapi: { include: false } },
  responses: {
    200: authBootstrapStatusSchema,
  },
});

export const switchActiveWorkspaceRoute = c.mutation({
  method: "POST",
  path: "/auth-context/active-workspace",
  summary: "Switch the current session's active workspace",
  metadata: { tags: ["auth"] },
  body: switchActiveWorkspaceBodySchema,
  responses: {
    200: authContextResponseSchema,
    400: errorBodySchema,
    401: errorBodySchema,
    403: errorBodySchema,
    404: errorBodySchema,
    422: errorBodySchema,
  },
});

export const listAuthTokensRoute = c.query({
  method: "GET",
  path: "/auth-tokens",
  summary: "List agent access tokens",
  metadata: { tags: ["auth"] },
  responses: {
    200: authTokenListResponseSchema,
    401: errorBodySchema,
    403: errorBodySchema,
  },
});

export const createAuthTokenRoute = c.mutation({
  method: "POST",
  path: "/auth-tokens",
  summary: "Create an agent access token",
  metadata: { tags: ["auth"] },
  body: createAuthTokenBodySchema,
  responses: {
    201: createAuthTokenResponseSchema,
    400: errorBodySchema,
    401: errorBodySchema,
    403: errorBodySchema,
    422: errorBodySchema,
  },
});

export const revokeAuthTokenRoute = c.mutation({
  method: "DELETE",
  path: "/auth-tokens/:id",
  summary: "Revoke an agent access token",
  metadata: { tags: ["auth"] },
  pathParams: z.object({
    id: z.string(),
  }),
  body: c.noBody(),
  responses: {
    204: c.noBody(),
    401: errorBodySchema,
    403: errorBodySchema,
    404: errorBodySchema,
  },
});
