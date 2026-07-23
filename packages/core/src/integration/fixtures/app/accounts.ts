import { z } from "zod";
import { initContract, TsRestApi } from "../../../api/index.js";
import type { SapportaEnv } from "../../../api/server.js";
import { scopedRows } from "../../../data/scoped-rows.js";
import { createTableCatalog } from "../../../schema/catalog.js";
import { accounts } from "../schema/accounts.js";

const c = initContract();
const catalog = createTableCatalog([accounts]);

const createAccountRoute = c.mutation({
  method: "POST",
  path: "/accounts",
  summary: "Create an account",
  body: z.object({
    name: z.string().min(1),
    type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
    balance: z.number().optional(),
  }),
  responses: {
    200: z.object({ data: z.record(z.string(), z.unknown()) }),
  },
});

const api = new TsRestApi<SapportaEnv>();

api.register("createAccount", createAccountRoute, async ({ c, request }) => {
  const db = c.get("db");
  const auth = c.get("auth");
  const result = await scopedRows(db, auth, accounts, {
    searchPlan: catalog.searchPlanFor(accounts.sqlName),
  }).create(request.body);
  if (Array.isArray(result)) {
    throw new Error("Expected a single account from a single-row create.");
  }
  return { status: 200, body: { data: result } };
});

export default api;
