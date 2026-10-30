import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { LookupNarrowing } from "./api/lookup";
import type { LookupSearchMode } from "./source";

export type LookupForColumn<TMeta = unknown> = (
  column: ColumnSchema,
) => LookupCapabilities<LookupValue, TMeta> | undefined;

export type LookupStore<TMeta = unknown> = {
  /** A table's lookup; with `narrowing`, its search offers only the rows
   *  that match. `options.search` says where the search runs; see
   *  `LookupSearchMode`. */
  table(
    tableName: string,
    narrowing?: LookupNarrowing,
    options?: { search?: LookupSearchMode },
  ): LookupCapabilities<LookupValue, TMeta>;
  foreignKey: LookupForColumn<TMeta>;
  requireForeignKey(args: {
    tableName: string;
    column: ColumnSchema;
  }): LookupCapabilities<LookupValue, TMeta>;
  clear(): void;
};
