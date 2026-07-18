import type { SearchLookup } from "./cache/search-lookup";
import type { LookupValue, ValueLookup } from "./cache/value-lookup";

export type LookupCapabilities<
  TValue extends LookupValue = LookupValue,
  TMeta = unknown,
> = {
  valueLookup: ValueLookup<TValue, TMeta>;
  searchLookup?: SearchLookup<TValue, TMeta>;
};
