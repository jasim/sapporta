import type { FilterCondition } from "@sapporta/shared/filter";

export type TGridFilter = {
  conditions: FilterCondition[];
  search: string | null;
};
