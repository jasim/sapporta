import { z } from "zod";
import { initContract, TsRestApi } from "../../../api/index.js";
import type { SapportaEnv } from "../../../api/server.js";
import { accounts } from "../schema/accounts.js";

const c = initContract();

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
  const input = request.body;
  const result = db
    .insert(accounts.drizzle)
    .values(input as typeof accounts.drizzle.$inferInsert)
    .returning()
    .all();
  return { status: 200, body: { data: result[0] } };
});

export default api;
