import { describe, it, expect } from "vitest";
import {
  sqliteTable,
  text,
  integer,
  SQLiteSyncDialect,
} from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import { countQuerySchema } from "@sapporta/shared/contracts";
import { timestamp } from "../schema/table.js";
import { sapportaTable } from "../schema/table.js";
import type { TableDef } from "../schema/table.js";
import { createTableCatalog } from "../schema/catalog.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import {
  resolveCountQuery,
  resolveExportQuery,
  resolveLookupQuery,
  resolvePageQuery,
} from "./table-query.js";

const dialect = new SQLiteSyncDialect();
const toSql = (s: SQL | undefined) => (s ? dialect.sqlToQuery(s).sql : "");
const compile = (s: SQL | undefined) => {
  if (!s) throw new Error("expected SQL fragment, got undefined");
  const q = dialect.sqlToQuery(s);
  return { sql: q.sql, params: q.params };
};

const ordersTable = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer: text("customer").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull(),
  created_at: timestamp("created_at").notNull(),
});

const orders = sapportaTable({
  drizzle: ordersTable,
  meta: { rowLabelColumns: ["customer"] },
});
const searchableOrders = sapportaTable({
  drizzle: ordersTable,
  meta: {
    rowLabelColumns: ["customer"],
    search: { self: ["customer", "status"] },
  },
});
const singleSearchOrders = sapportaTable({
  drizzle: ordersTable,
  meta: { rowLabelColumns: ["customer"], search: { self: ["customer"] } },
});
const disabledSearchTable = sapportaTable({
  drizzle: ordersTable,
  meta: { rowLabelColumns: ["customer"], search: false },
});

function parseQuery(
  params: Record<string, string>,
  table: TableDef = orders,
): {
  where: SQL | undefined;
  orderBy: SQL[];
  page: number;
  limit: number;
} {
  const catalog = createTableCatalog([table]);
  const resolved = resolvePageQuery(params, table, {
    auth: createTestAuthContext({ tables: [table] }),
    searchPlan: catalog.searchPlanFor(table.sqlName),
  });
  return {
    where: resolved.where as SQL | undefined,
    orderBy: resolved.orderBy as SQL[],
    page: resolved.page ?? 1,
    limit: resolved.limit ?? 50,
  };
}

describe("resolvePageQuery()", () => {
  it("defaults to page 1, limit 50", () => {
    const q = parseQuery({}, orders);
    expect(q.page).toBe(1);
    expect(q.limit).toBe(50);
    expect(q.where).toBeUndefined();
    expect(q.orderBy).toEqual([]);
  });

  it("parses page and limit", () => {
    const q = parseQuery({ page: "3", limit: "25" }, orders);
    expect(q.page).toBe(3);
    expect(q.limit).toBe(25);
  });

  it("resolves export filters and ordering without pagination", () => {
    const catalog = createTableCatalog([orders]);
    const resolved = resolveExportQuery(
      {
        "filter[status][eq]": "paid",
        sort: "-created_at",
      },
      orders,
      {
        auth: createTestAuthContext({ tables: [orders] }),
        searchPlan: catalog.searchPlanFor(orders.sqlName),
      },
    );

    expect(compile(resolved.where as SQL).params).toEqual(["paid"]);
    expect(resolved.orderBy).toHaveLength(1);
  });

  it("rejects pagination on exports", () => {
    const catalog = createTableCatalog([orders]);
    expect(() =>
      resolveExportQuery({ page: "3" }, orders, {
        auth: createTestAuthContext({ tables: [orders] }),
        searchPlan: catalog.searchPlanFor(orders.sqlName),
      }),
    ).toThrow(expect.objectContaining({ code: "bad_value" }));
  });

  it("resolves lookup IDs, fields, search, and limit into typed values", () => {
    const resolved = resolveLookupQuery(
      {
        ids: "1, 2",
        fields: "id,customer,id",
        q: "  Acme  ",
        limit: "20",
      },
      orders,
    );

    expect(resolved).toEqual({
      ids: [1, 2],
      fields: [ordersTable.id, ordersTable.customer],
      search: "Acme",
      limit: 20,
    });
  });

  it("rejects invalid lookup IDs and fields at the HTTP boundary", () => {
    expect(() => resolveLookupQuery({ ids: "nope" }, orders)).toThrow(
      expect.objectContaining({ code: "bad_value" }),
    );
    expect(() => resolveLookupQuery({ fields: "missing" }, orders)).toThrow(
      expect.objectContaining({ code: "unknown_column" }),
    );
  });

  // ── Filter operators ─────────────────────────────────────────────────

  describe("filter operators", () => {
    it("parses eq", () => {
      const q = parseQuery({ "filter[status][eq]": "paid" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe('"orders"."status" = ?');
      expect(params).toEqual(["paid"]);
    });

    it("parses neq", () => {
      const q = parseQuery({ "filter[status][neq]": "paid" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe('"orders"."status" <> ?');
      expect(params).toEqual(["paid"]);
    });

    it("parses ordinal operators", () => {
      for (const [op, glyph] of [
        ["gt", ">"],
        ["gte", ">="],
        ["lt", "<"],
        ["lte", "<="],
      ]) {
        const q = parseQuery({ [`filter[amount][${op}]`]: "100" }, orders);
        const { sql, params } = compile(q.where);
        expect(sql).toBe(`"orders"."amount" ${glyph} ?`);
        // The typed boundary parses numeric-column values to numbers before
        // they reach Drizzle — strings stopped being legal for gt/lt/gte/lte.
        expect(params).toEqual([100]);
      }
    });

    it("parses in with CSV values", () => {
      const q = parseQuery(
        { "filter[status][in]": "paid,void,refunded" },
        orders,
      );
      const { sql, params } = compile(q.where);
      expect(sql).toBe('"orders"."status" in (?, ?, ?)');
      expect(params).toEqual(["paid", "void", "refunded"]);
    });

    it("parses nin with CSV values", () => {
      const q = parseQuery({ "filter[status][nin]": "paid,void" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe('"orders"."status" not in (?, ?)');
      expect(params).toEqual(["paid", "void"]);
    });

    it("contains wraps value with %...% and escapes LIKE wildcards", () => {
      const q = parseQuery({ "filter[customer][contains]": "50%_off" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe(`"orders"."customer" LIKE ? ESCAPE '\\'`);
      expect(params).toEqual(["%50\\%\\_off%"]);
    });

    it("startswith anchors to the beginning", () => {
      const q = parseQuery({ "filter[customer][startswith]": "Acme" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe(`"orders"."customer" LIKE ? ESCAPE '\\'`);
      expect(params).toEqual(["Acme%"]);
    });

    it("endswith anchors to the end", () => {
      const q = parseQuery({ "filter[customer][endswith]": "Inc" }, orders);
      const { sql, params } = compile(q.where);
      expect(sql).toBe(`"orders"."customer" LIKE ? ESCAPE '\\'`);
      expect(params).toEqual(["%Inc"]);
    });

    it("escapes backslashes in substring values", () => {
      const q = parseQuery({ "filter[customer][contains]": "a\\b" }, orders);
      const { params } = compile(q.where);
      expect(params).toEqual(["%a\\\\b%"]);
    });

    it("is=null → IS NULL", () => {
      const q = parseQuery({ "filter[amount][is]": "null" }, orders);
      expect(toSql(q.where)).toBe('"orders"."amount" is null');
    });

    it("is=notnull → IS NOT NULL", () => {
      const q = parseQuery({ "filter[amount][is]": "notnull" }, orders);
      expect(toSql(q.where)).toBe('"orders"."amount" is not null');
    });
  });

  // ── Sort ─────────────────────────────────────────────────────────────

  describe("sort", () => {
    it("parses ascending", () => {
      const q = parseQuery({ sort: "customer" }, orders);
      expect(q.orderBy).toHaveLength(1);
      expect(toSql(q.orderBy[0])).toMatch(/"customer" asc/i);
    });

    it("parses descending", () => {
      const q = parseQuery({ sort: "-created_at" }, orders);
      expect(q.orderBy).toHaveLength(1);
      expect(toSql(q.orderBy[0])).toMatch(/"created_at" desc/i);
    });

    it("parses multiple fields", () => {
      const q = parseQuery({ sort: "-amount,customer" }, orders);
      expect(q.orderBy).toHaveLength(2);
    });
  });

  // ── Errors ───────────────────────────────────────────────────────────

  describe("errors", () => {
    it("unknown_filter_shape — filter[col] without [op]", () => {
      expect(() => parseQuery({ "filter[status]": "paid" }, orders)).toThrow(
        expect.objectContaining({ code: "unknown_filter_shape" }),
      );
    });

    it("unknown_filter_shape — nested beyond two brackets", () => {
      expect(() =>
        parseQuery({ "filter[status][eq][extra]": "x" }, orders),
      ).toThrow(expect.objectContaining({ code: "unknown_filter_shape" }));
    });

    it("unknown_column — filter references missing column", () => {
      expect(() =>
        parseQuery({ "filter[naration][eq]": "foo" }, orders),
      ).toThrow(expect.objectContaining({ code: "unknown_column" }));
    });

    it("unknown_column — sort references missing column", () => {
      expect(() => parseQuery({ sort: "unknown" }, orders)).toThrow(
        expect.objectContaining({ code: "unknown_column" }),
      );
    });

    it("rejects unknown top-level parameters", () => {
      expect(() => parseQuery({ srot: "customer" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_value" }),
      );
    });

    it("unknown_op — op not in the supported set", () => {
      expect(() =>
        parseQuery({ "filter[status][like]": "paid" }, orders),
      ).toThrow(expect.objectContaining({ code: "unknown_op" }));
    });

    it("bad_value — is= with value other than null/notnull", () => {
      expect(() =>
        parseQuery({ "filter[amount][is]": "empty" }, orders),
      ).toThrow(expect.objectContaining({ code: "bad_value" }));
    });

    it("bad_value — in= empty", () => {
      expect(() => parseQuery({ "filter[status][in]": "" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_value" }),
      );
    });

    it("bad_value — in= with empty item (trailing comma)", () => {
      expect(() =>
        parseQuery({ "filter[status][in]": "paid,,void" }, orders),
      ).toThrow(expect.objectContaining({ code: "bad_value" }));
    });

    it("bad_limit — above cap", () => {
      expect(() => parseQuery({ limit: "5000" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_limit" }),
      );
    });

    it("bad_limit — zero", () => {
      expect(() => parseQuery({ limit: "0" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_limit" }),
      );
    });

    it("bad_limit — non-numeric", () => {
      expect(() => parseQuery({ limit: "abc" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_limit" }),
      );
    });

    it("bad_limit — non-canonical integer", () => {
      expect(() => parseQuery({ limit: "01" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_limit" }),
      );
    });

    it("bad_page — non-numeric", () => {
      expect(() => parseQuery({ page: "abc" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_page" }),
      );
    });

    it("bad_page — non-canonical integer", () => {
      expect(() => parseQuery({ page: "01" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_page" }),
      );
    });

    it("bad_page — zero", () => {
      expect(() => parseQuery({ page: "0" }, orders)).toThrow(
        expect.objectContaining({ code: "bad_page" }),
      );
    });
  });

  // ── Search term parsing ───────────────────────────────────────────────

  describe("search term (q)", () => {
    it("compiles the complete trimmed term into the search predicate", () => {
      const q = parseQuery({ q: "foo" }, searchableOrders);
      const { sql, params } = compile(q.where);
      expect(sql.toLowerCase()).toContain("like");
      expect(params).toEqual(["%foo%", "%foo%"]);
    });

    it("does not split or otherwise interpret the term", () => {
      const q = parseQuery({ q: "  blue moon  " }, singleSearchOrders);
      expect(compile(q.where).params).toEqual(["%blue moon%"]);
    });

    it("composes structured filters with search", () => {
      const q = parseQuery(
        { q: "foo", "filter[status][eq]": "paid" },
        searchableOrders,
      );
      const { sql, params } = compile(q.where);
      expect(sql).toContain('"orders"."status" = ?');
      expect(sql.toLowerCase()).toContain("like");
      expect(params).toEqual(["paid", "%foo%", "%foo%"]);
    });

    it("composes with sort and pagination", () => {
      const q = parseQuery(
        { q: "foo", sort: "-created_at", page: "2", limit: "25" },
        searchableOrders,
      );
      expect(compile(q.where).params).toEqual(["%foo%", "%foo%"]);
      expect(q.orderBy).toHaveLength(1);
      expect(toSql(q.orderBy[0])).toMatch(/"created_at" desc/i);
      expect(q.page).toBe(2);
      expect(q.limit).toBe(25);
    });

    it("treats empty q as absent (no predicate, no error)", () => {
      const q = parseQuery({ q: "" }, searchableOrders);
      expect(q.where).toBeUndefined();
    });

    it("treats whitespace-only q as absent", () => {
      const q = parseQuery({ q: "   " }, searchableOrders);
      expect(q.where).toBeUndefined();
    });

    it("throws no_search_config when table search is disabled", () => {
      expect(() => parseQuery({ q: "foo" }, disabledSearchTable)).toThrow(
        expect.objectContaining({ code: "no_search_config" }),
      );
    });
  });
});

describe("resolveCountQuery()", () => {
  it("resolves canonical filters and grouping", () => {
    const resolved = resolveCountQuery(
      countQuerySchema.parse({
        "filter[amount][gte]": "100",
        group_by: "status",
        order: "asc",
        limit: "2",
      }),
      orders,
    );

    expect(resolved.kind).toBe("grouped");
    if (resolved.kind !== "grouped") {
      throw new Error("Expected a grouped count query");
    }
    expect(compile(resolved.input.where).params).toEqual([100]);
    expect(resolved.input).toMatchObject({
      column: ordersTable.status,
      order: "asc",
      limit: 2,
    });
  });

  it("rejects invalid and contradictory count queries", () => {
    expect(() => countQuerySchema.parse({ group_by: "" })).toThrow();
    expect(() =>
      countQuerySchema.parse({ group_by: "id", limit: 1001 }),
    ).toThrow();
    expect(() =>
      resolveCountQuery(
        countQuerySchema.parse({ group_by: "missing" }),
        orders,
      ),
    ).toThrow(expect.objectContaining({ code: "unknown_column" }));
    expect(() =>
      resolveCountQuery(countQuerySchema.parse({ order: "asc" }), orders),
    ).toThrow(expect.objectContaining({ code: "bad_value" }));
    expect(() =>
      resolveCountQuery(countQuerySchema.parse({ surprise: "yes" }), orders),
    ).toThrow(expect.objectContaining({ code: "bad_value" }));
  });
});
