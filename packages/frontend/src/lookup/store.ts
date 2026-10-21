import type { LookupCapabilities, LookupValue } from "@sapporta/grid/lookup";
import type { ColumnSchema } from "@sapporta/shared/contracts";

export type LookupForColumn<TMeta = unknown> = (
  column: ColumnSchema,
) => LookupCapabilities<LookupValue, TMeta> | undefined;

export type LookupStore<TMeta = unknown> = {
  table(tableName: string): LookupCapabilities<LookupValue, TMeta>;
  foreignKey: LookupForColumn<TMeta>;
  requireForeignKey(args: {
    tableName: string;
    column: ColumnSchema;
  }): LookupCapabilities<LookupValue, TMeta>;
  clear(): void;
};
