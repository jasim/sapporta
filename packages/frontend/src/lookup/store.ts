import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";
import type { LookupNarrowing } from "./api/lookup";

export type LookupForColumn<TMeta = unknown> = (
  column: ColumnSchema,
) => LookupCapabilities<LookupValue, TMeta> | undefined;

export type LookupStore<TMeta = unknown> = {
  /** A table's lookup; with `narrowing`, its search offers only the rows
   *  that match. */
  table(
    tableName: string,
    narrowing?: LookupNarrowing,
  ): LookupCapabilities<LookupValue, TMeta>;
  foreignKey: LookupForColumn<TMeta>;
  requireForeignKey(args: {
    tableName: string;
    column: ColumnSchema;
  }): LookupCapabilities<LookupValue, TMeta>;
  clear(): void;
};
