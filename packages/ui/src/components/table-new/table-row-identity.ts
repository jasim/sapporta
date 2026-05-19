import type { LevelOptions } from "@/grid";

export function tableRowIdentity(
  pkField: string,
  immutable: boolean,
): LevelOptions {
  return {
    rowKey: (node) => {
      const v = node.columns[pkField];
      if (v == null) {
        throw new Error(
          `tableRowIdentity: row is missing primary key '${pkField}'. ` +
            `Every row must carry a non-null PK for grid identity to be stable.`,
        );
      }
      return String(v);
    },
    allowPhantoms: !immutable,
  };
}
