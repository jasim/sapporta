// Sample ts-rest contract shared between the backend (`packages/api/app/hello.ts`)
// and the frontend (`packages/frontend/src/api.ts`). The contract is the single
// source of truth for the request and response shape — declare it once,
// register a handler against it on the server, and call it via a typed
// client on the frontend.
//
// Delete this file once you have your own contracts, or use it as a
// template for adding new ones.

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
