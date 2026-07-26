// Shared description for the sample `/hello` API. The backend registers its
// handler, and the frontend turns the same contract into a typed client.
//
// Delete this sample once you have your own contracts, or use it as a template.

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

export const helloContract = c.router({
  hello: c.query({
    method: "GET",
    path: "/hello",
    summary: "Say hello",
    responses: {
      200: z.object({ message: z.string() }),
    },
  }),
});
