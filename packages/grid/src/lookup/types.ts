import type { SearchLookup } from "./cache/search-lookup";
import type { ValueLookup } from "./cache/value-lookup";

export type LookupCapabilities = {
  valueLookup: ValueLookup;
  searchLookup?: SearchLookup;
};
