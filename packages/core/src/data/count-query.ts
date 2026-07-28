import type { CountQuery } from "@sapporta/shared/contracts";
import { DEFAULT_COUNT_GROUP_LIMIT } from "@sapporta/shared";
import { columnBySqlName } from "../schema/column.js";
import { QueryParseError } from "../db/errors.js";
import type { TableDef } from "../schema/table.js";
import type { CountRowsByInput, CountRowsInput } from "./count-rows.js";
import { parseTableFilters } from "./query-parser.js";

export type ResolvedCountQuery =
  | {
      kind: "total";
      input: CountRowsInput;
    }
  | {
      kind: "grouped";
      input: CountRowsByInput;
    };

const COUNT_QUERY_KEYS = new Set(["group_by", "order", "limit"]);

/**
 * Resolve the validated count-route query into the transport-free inputs used
 * by the row-scoped count operations.
 */
export function resolveCountQuery(
  query: CountQuery,
  table: TableDef,
): ResolvedCountQuery {
  const where = parseTableFilters(filterParams(query), table);
  const groupBy = query.group_by;

  if (groupBy === undefined) {
    if (query.order !== undefined || query.limit !== undefined) {
      throw new QueryParseError(
        "bad_value",
        "order and limit require group_by",
      );
    }
    return { kind: "total", input: { where } };
  }

  const column = columnBySqlName(table, groupBy);
  if (!column) {
    throw new QueryParseError(
      "unknown_column",
      `Column "${groupBy}" not found on table "${table.sqlName}"`,
    );
  }

  return {
    kind: "grouped",
    input: {
      where,
      column,
      order: query.order ?? "desc",
      limit: query.limit ?? DEFAULT_COUNT_GROUP_LIMIT,
    },
  };
}

function filterParams(query: CountQuery): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (COUNT_QUERY_KEYS.has(key)) continue;
    if (!key.startsWith("filter[")) {
      throw new QueryParseError(
        "bad_value",
        `Unknown count query parameter ${JSON.stringify(key)}`,
      );
    }
    if (typeof value !== "string") {
      throw new QueryParseError(
        "bad_value",
        `Count filter ${JSON.stringify(key)} must be a string`,
      );
    }
    filters[key] = value;
  }
  return filters;
}
