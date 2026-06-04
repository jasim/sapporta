import { initContract } from "@sapporta/rest-core";
import { errorBodySchema } from "./error.js";
import {
  authBootstrapStatusSchema,
  authContextResponseSchema,
  switchActiveWorkspaceBodySchema,
} from "./auth-schema.js";

const c = initContract();

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
  summary: "Read public Sapporta auth bootstrap status",
  metadata: { tags: ["auth"] },
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
