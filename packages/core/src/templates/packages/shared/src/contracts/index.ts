// Barrel for ts-rest contracts. Add one file per feature alongside
// `hello.ts` and re-export its router from here so `packages/shared/src/index.ts`
// can pick everything up in one place.

export { helloContract } from "./hello.js";
export { publicApiSampleContract } from "./public-api-sample.js";
