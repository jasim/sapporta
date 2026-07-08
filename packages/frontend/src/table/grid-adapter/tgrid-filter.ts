import type { TypedFilterCondition } from "@sapporta/shared/filter";

export type TGridFilter = {
  conditions: TypedFilterCondition[];
  search: string | null;
};
