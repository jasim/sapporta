import type { SelectOption } from "./types";

export function normalizeOptions(
  options: readonly (SelectOption | string)[],
): readonly SelectOption[] {
  return options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
}
