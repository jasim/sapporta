// PUBLIC API SAMPLE CONTRACT
//
// The matching backend route is allow-listed for anonymous visitors. Keep this
// contract limited to response data the application intentionally exposes to
// the public internet.

import { z } from "zod";
import { initContract } from "@sapporta/rest-core";

const c = initContract();

export const publicApiSampleContract = c.router({
  publicApiSample: c.query({
    method: "GET",
    path: "/public-api-sample",
    summary: "Read public API sample",
    responses: {
      200: z.object({ message: z.string() }),
    },
  }),
});
