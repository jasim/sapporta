export type CountGroupValue = string | number | boolean | null;

export interface GroupCount {
  value: CountGroupValue;
  count: number;
}

export const DEFAULT_COUNT_GROUP_LIMIT = 50;
export const MAX_COUNT_GROUPS = 1000;
