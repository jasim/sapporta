import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { checkReportDefinition, checkReportSqlColumns } from "./check.js";
import type { CheckSql } from "./check.js";
import type { ReportDefinition } from "./report.js";

describe("checkReportDefinition", () => {
  it("returns no issues for a valid report", () => {
    const def: ReportDefinition = {
      name: "valid",
      label: "Valid Report",
      params: [],
      sources: {
        items: { query: "SELECT name, amount FROM items" },
      },
      tree: {
        source: "items",
        levelName: "item",
        columns: [
          { name: "name", header: "Name" },
          { name: "amount", header: "Amount" },
        ],
      },
    };

    expect(checkReportDefinition(def)).toEqual([]);
  });

  it("detects missing source reference", () => {
    const def: ReportDefinition = {
      name: "bad-source",
      label: "Bad Source",
      params: [],
      sources: {
        items: { query: "SELECT 1" },
      },
      tree: {
        source: "nonexistent",
        levelName: "item",
        columns: [{ name: "name" }],
      },
    };

    const issues = checkReportDefinition(def);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("item");
    expect(issues[0].message).toContain("nonexistent");
    expect(issues[0].message).toContain("not found in sources");
  });

  it("detects missing source in child node", () => {
    const def: ReportDefinition = {
      name: "bad-child-source",
      label: "Bad Child Source",
      params: [],
      sources: {
        parents: { query: "SELECT name FROM groups" },
      },
      tree: {
        source: "parents",
        levelName: "group",
        columns: [{ name: "name" }],
        children: [
          {
            source: "missing_source",
            levelName: "detail",
            columns: [{ name: "info" }],
          },
        ],
      },
    };

    const issues = checkReportDefinition(def);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("group.detail");
    expect(issues[0].message).toContain("missing_source");
  });

  it("detects rollup keys not declared in columns[]", () => {
    const def: ReportDefinition = {
      name: "rollup-warn",
      label: "Rollup Warn",
      params: [],
      sources: {
        parents: { query: "SELECT name FROM groups" },
        kids: { query: "SELECT name FROM items" },
      },
      tree: {
        source: "parents",
        levelName: "group",
        columns: [{ name: "name" }],
        rollup: (children) => ({
          total: children.item.reduce((s) => s + 1, 0),
          count: children.item.length,
        }),
        children: [
          {
            source: "kids",
            levelName: "item",
            columns: [{ name: "name" }],
          },
        ],
      },
    };

    const issues = checkReportDefinition(def);
    expect(issues).toHaveLength(2);
    expect(issues[0].path).toBe("group.rollup");
    expect(issues[0].message).toContain('"total"');
    expect(issues[0].message).toContain('level "group"');
    expect(issues[1].path).toBe("group.rollup");
    expect(issues[1].message).toContain('"count"');
  });

  it("does not warn for rollup keys that are declared", () => {
    const def: ReportDefinition = {
      name: "rollup-ok",
      label: "Rollup OK",
      params: [],
      sources: {
        parents: { query: "SELECT name FROM groups" },
        kids: { query: "SELECT name FROM items" },
      },
      tree: {
        source: "parents",
        levelName: "group",
        columns: [
          { name: "name" },
          { name: "total", header: "Total", kind: "number", displayFormat: "currency" },
        ],
        rollup: (children) => ({
          total: children.item.reduce((s) => s + 1, 0),
        }),
        children: [
          {
            source: "kids",
            levelName: "item",
            columns: [{ name: "name" }],
          },
        ],
      },
    };

    expect(checkReportDefinition(def)).toEqual([]);
  });

  it("detects footer keys not declared in columns[]", () => {
    const def: ReportDefinition = {
      name: "footer-warn",
      label: "Footer Warn",
      params: [],
      sources: {
        items: { query: "SELECT name FROM items" },
      },
      tree: {
        source: "items",
        levelName: "item",
        columns: [{ name: "name" }],
        footer: [
          {
            label: "Grand Total",
            compute: () => ({
              grand_total: 0,
              extra: 0,
            }),
          },
        ],
      },
    };

    const issues = checkReportDefinition(def);
    expect(issues).toHaveLength(2);
    expect(issues[0].path).toBe('item.footer["Grand Total"]');
    expect(issues[0].message).toContain('"grand_total"');
    expect(issues[1].message).toContain('"extra"');
  });

  it("does not warn for footer keys that are declared", () => {
    const def: ReportDefinition = {
      name: "footer-ok",
      label: "Footer OK",
      params: [],
      sources: {
        items: { query: "SELECT name, amount FROM items" },
      },
      tree: {
        source: "items",
        levelName: "item",
        columns: [
          { name: "name" },
          { name: "amount", header: "Amount" },
        ],
        footer: [
          {
            label: "Total",
            compute: () => ({ amount: 0 }),
          },
        ],
      },
    };

    expect(checkReportDefinition(def)).toEqual([]);
  });

  it("detects multiple issues across the tree", () => {
    const def: ReportDefinition = {
      name: "multi-issue",
      label: "Multi Issue",
      params: [],
      sources: {
        sections: { query: "SELECT section FROM sections" },
        // "accounts" source is missing
      },
      tree: {
        source: "sections",
        levelName: "section",
        columns: [{ name: "section" }],
        rollup: (children) => ({
          section_total: children.accounts?.reduce((s) => s, 0) ?? 0,
        }),
        footer: [
          {
            label: "Net",
            compute: () => ({ section_total: 0 }),
          },
        ],
        children: [
          {
            source: "accounts",
            levelName: "accounts",
            columns: [{ name: "name" }],
          },
        ],
      },
    };

    const issues = checkReportDefinition(def);
    // Should have: rollup undeclared key, footer undeclared key, child missing source
    expect(issues.length).toBe(3);

    const rollupIssue = issues.find((i) => i.path.includes("rollup"));
    expect(rollupIssue).toBeDefined();
    expect(rollupIssue!.message).toContain('"section_total"');

    const footerIssue = issues.find((i) => i.path.includes("footer"));
    expect(footerIssue).toBeDefined();
    expect(footerIssue!.message).toContain('"section_total"');

    const sourceIssue = issues.find((i) => i.path === "section.accounts");
    expect(sourceIssue).toBeDefined();
    expect(sourceIssue!.message).toContain("accounts");
  });

  it("validates the balance-sheet pattern (valid)", () => {
    const def: ReportDefinition = {
      name: "balance-sheet",
      label: "Balance Sheet",
      params: [
        { name: "as_of_date", type: "date", required: true, label: "As of Date" },
      ],
      sources: {
        sections: { query: "SELECT section FROM sections" },
        section_accounts: { query: "SELECT name, balance FROM accounts WHERE section = $section" },
      },
      tree: {
        source: "sections",
        levelName: "section",
        columns: [
          { name: "section", header: "Section" },
          { name: "section_total", header: "Total", kind: "number", displayFormat: "currency" },
        ],
        rollup: (children) => ({
          section_total: children.accounts.reduce(
            (s, n) => s + Number(n.columns.balance ?? 0),
            0,
          ),
        }),
        footer: [
          {
            label: "Total",
            compute: (nodes) => ({
              section_total: nodes.reduce(
                (s, n) => s + Number(n.rollup?.section_total ?? 0),
                0,
              ),
            }),
          },
        ],
        children: [
          {
            source: "section_accounts",
            levelName: "accounts",
            columns: [
              { name: "name", header: "Account" },
              { name: "balance", header: "Balance", kind: "number", displayFormat: "currency" },
            ],
          },
        ],
      },
    };

    expect(checkReportDefinition(def)).toEqual([]);
  });

  it("handles rollup that throws with empty children gracefully", () => {
    const def: ReportDefinition = {
      name: "rollup-throws",
      label: "Rollup Throws",
      params: [],
      sources: {
        parents: { query: "SELECT name FROM groups" },
        kids: { query: "SELECT name FROM items" },
      },
      tree: {
        source: "parents",
        levelName: "group",
        columns: [{ name: "name" }],
        rollup: (children) => {
          // This will throw because children.item[0] is undefined
          return { total: children.item[0].columns.amount as number };
        },
        children: [
          {
            source: "kids",
            levelName: "item",
            columns: [{ name: "name" }],
          },
        ],
      },
    };

    // Should not throw — just silently skip the rollup check
    const issues = checkReportDefinition(def);
    // Only the items that could be checked are reported; no crash
    expect(issues).toEqual([]);
  });

  it("handles footer compute that throws with empty input gracefully", () => {
    const def: ReportDefinition = {
      name: "footer-throws",
      label: "Footer Throws",
      params: [],
      sources: {
        items: { query: "SELECT name FROM items" },
      },
      tree: {
        source: "items",
        levelName: "item",
        columns: [{ name: "name" }],
        footer: [
          {
            label: "Problematic",
            compute: (nodes) => {
              // This will throw when nodes is empty
              return { total: nodes[0].columns.amount as number };
            },
          },
        ],
      },
    };

    // Should not throw — gracefully skip
    const issues = checkReportDefinition(def);
    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DB-aware column checks (checkReportSqlColumns)
// ---------------------------------------------------------------------------

/**
 * Create a CheckSql adapter from better-sqlite3. The CheckSql interface
 * requires result arrays with a `.columns` property containing column
 * metadata. We use .prepare().columns() to discover column names, then
 * attach them to the result array.
 */
function createCheckSql(sqlite: Database.Database): CheckSql {
  return {
    unsafe: (query: string, params?: unknown[]) => {
      const stmt = sqlite.prepare(query);
      const rows = stmt.all(...(params ?? [])) as any;
      // Attach column metadata matching the CheckSql contract
      rows.columns = stmt.columns().map((c: any) => ({ name: c.name }));
      return Promise.resolve(rows);
    },
  };
}

describe("checkReportSqlColumns", () => {
  let sqlite: Database.Database;
  let sql: CheckSql;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sql = createCheckSql(sqlite);
    sqlite.exec(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT
      )
    `);
    sqlite.exec(`
      CREATE TABLE sections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        section TEXT NOT NULL
      )
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("no issues for valid SQL with undeclared columns (no longer flagged)", async () => {
    const def: ReportDefinition = {
      name: "undeclared-ok",
      label: "Undeclared OK",
      params: [],
      sources: {
        items: { query: "SELECT id, name, amount, category FROM items" },
      },
      tree: {
        source: "items",
        levelName: "item",
        columns: [{ name: "name" }],
        transform: (nodes) => nodes,
      },
    };

    const issues = await checkReportSqlColumns(sql, def);
    expect(issues).toEqual([]);
  });

  it("validates valid SQL passes planning", async () => {
    const def: ReportDefinition = {
      name: "valid-sql",
      label: "Valid SQL",
      params: [],
      sources: {
        items: { query: "SELECT name, amount FROM items" },
      },
      tree: {
        source: "items",
        levelName: "item",
        columns: [{ name: "name" }, { name: "amount" }],
      },
    };

    const issues = await checkReportSqlColumns(sql, def);
    expect(issues).toEqual([]);
  });

  it("catches SQL planning errors", async () => {
    const def: ReportDefinition = {
      name: "bad-planning",
      label: "Bad Planning",
      params: [],
      sources: {
        missing: { query: "SELECT * FROM nonexistent_table" },
      },
      tree: {
        source: "missing",
        levelName: "item",
        columns: [{ name: "name" }],
      },
    };

    const issues = await checkReportSqlColumns(sql, def);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("SQL planning failed");
    expect(issues[0].message).toContain("nonexistent_table");
  });

  it("handles bind variables (replaced with NULLs for planning)", async () => {
    const def: ReportDefinition = {
      name: "bind-vars",
      label: "Bind Vars",
      params: [],
      sources: {
        items: {
          query: "SELECT name, amount FROM items WHERE category = $cat AND amount > $min",
        },
      },
      tree: {
        source: "items",
        levelName: "item",
        columns: [{ name: "name" }],
      },
    };

    // Valid SQL with bind variables should pass planning
    const issues = await checkReportSqlColumns(sql, def);
    expect(issues).toEqual([]);
  });
});
