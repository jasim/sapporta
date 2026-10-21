import type { ComponentType } from "react";
import type { z } from "zod";
import type {
  CellSlotProps,
  LabelSlotProps,
  ReferenceSlotProps,
  TableDisplay,
} from "./row-display-types";

/** Value schemas of a table's computed fields, by field name. */
export type ComputedSchemas = Readonly<Record<string, z.ZodType>>;

/** The values a typed slot receives: each field's value, or `null` for a
 *  row that has no value. */
export type ComputedOf<S extends ComputedSchemas> = {
  readonly [K in keyof S]: z.output<S[K]> | null;
};

/** A slot whose `needs` are the names in `S`. */
export type TypedSlot<S extends ComputedSchemas, P> = {
  needs?: readonly Extract<keyof S, string>[];
  referenceNeeds?: readonly string[];
  render?: ComponentType<P>;
};

/** A table's display slots, typed by its computed field schemas. */
export type TypedTableDisplay<S extends ComputedSchemas> = {
  label?: TypedSlot<S, LabelSlotProps<ComputedOf<S>>>;
  columns?: Record<
    string,
    | TypedSlot<S, CellSlotProps<ComputedOf<S>>>
    | TypedSlot<S, ReferenceSlotProps<ComputedOf<S>>>
  >;
};

/**
 * Types a table's display slots by the schemas of its computed fields, which
 * the app declares once and uses on the server too:
 *
 * ```ts
 * // src/shared/computed.ts
 * export const itemComputed = { onHand: z.number(), stockLine: z.string() };
 *
 * defineRowDisplays({
 *   items: tableDisplay(itemComputed, {
 *     label: { needs: ["onHand"], render: ({ label, computed }) => … },
 *   }),
 * });
 * ```
 *
 * `needs` then accepts only the schemas' names, and `computed.onHand` is a
 * number (or `null`). The type lists every field of `schemas`, but a slot
 * receives only the fields it `needs`; read only those. The values are not
 * checked here: the server checks them against the same schemas.
 */
export function tableDisplay<S extends ComputedSchemas>(
  _schemas: S,
  display: TypedTableDisplay<S>,
): TableDisplay {
  return display as TableDisplay;
}
