import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  extractBindVariables,
  buildPositionalQuery,
  resolveParams,
  executeReport,
} from "./engine.js";
import { createReportSqlClient } from "./sqlite-sql-client.js";
import { report } from "./report.js";
import type { ReportOutputNode } from "@sapporta/shared/contracts";
import type { ReportDefinition } from "./report.js";
import { Temporal, relative } from "@sapporta/shared";

// ---------------------------------------------------------------------------
// Unit tests: bind variable extraction
// ---------------------------------------------------------------------------

describe("extractBindVariables", () => {
  it("extracts named variables", () => {
    expect(
      extractBindVariables("SELECT * FROM t WHERE a = $foo AND b = $bar"),
    ).toEqual(["foo", "bar"]);
  });

  it("deduplicates", () => {
    expect(
      extractBindVariables("SELECT * FROM t WHERE a = $x OR b = $x"),
    ).toEqual(["x"]);
  });

  it("skips positional $1 params", () => {
    expect(extractBindVariables("SELECT * FROM t WHERE a = $1")).toEqual([]);
  });

  it("skips variables inside single-quoted strings", () => {
    expect(
      extractBindVariables("SELECT '$not_a_var' FROM t WHERE a = $real"),
    ).toEqual(["real"]);
  });

  it("skips variables in line comments", () => {
    expect(
      extractBindVariables("SELECT * FROM t -- $not_this\nWHERE a = $this"),
    ).toEqual(["this"]);
  });

  it("skips variables in block comments", () => {
    expect(
      extractBindVariables("SELECT /* $not_this */ * FROM t WHERE a = $this"),
    ).toEqual(["this"]);
  });

  // -- escaped quotes (the latent bug this commit fixes) --

  it("skips bind vars inside strings with escaped quotes", () => {
    expect(
      extractBindVariables(
        "SELECT * FROM t WHERE a = 'it''s $nope' AND b = $real",
      ),
    ).toEqual(["real"]);
  });

  it("handles multiple escaped quotes in a row", () => {
    expect(extractBindVariables("SELECT '''' || $x")).toEqual(["x"]);
  });

  it("handles escaped quote followed immediately by closing quote", () => {
    expect(extractBindVariables("SELECT 'ab''cd' FROM t WHERE a = $y")).toEqual(
      ["y"],
    );
  });

  // -- unterminated constructs --

  it("handles unterminated single-quoted string", () => {
    expect(extractBindVariables("SELECT 'unterminated $hidden")).toEqual([]);
  });

  it("handles unterminated block comment", () => {
    expect(extractBindVariables("SELECT /* unclosed $hidden")).toEqual([]);
  });

  // -- line comments at EOF --

  it("handles line comment at end of input with no newline", () => {
    expect(extractBindVariables("SELECT $x -- trailing $not_this")).toEqual([
      "x",
    ]);
  });

  // -- things inside strings that look like comments --

  it("does not treat -- inside a string as a comment", () => {
    expect(
      extractBindVariables(
        "SELECT '-- not a comment $nope' FROM t WHERE a = $real",
      ),
    ).toEqual(["real"]);
  });

  it("does not treat /* inside a string as a block comment", () => {
    expect(
      extractBindVariables(
        "SELECT '/* not a comment */' FROM t WHERE a = $real",
      ),
    ).toEqual(["real"]);
  });

  // -- $ edge cases --

  it("returns empty for no bind variables", () => {
    expect(extractBindVariables("SELECT 1")).toEqual([]);
  });

  it("returns empty for empty string", () => {
    expect(extractBindVariables("")).toEqual([]);
  });

  it("ignores bare $ at end of input", () => {
    expect(extractBindVariables("SELECT $")).toEqual([]);
  });

  it("ignores $ followed by a digit", () => {
    expect(extractBindVariables("SELECT $1, $22, $x")).toEqual(["x"]);
  });

  it("extracts vars starting with underscore", () => {
    expect(extractBindVariables("SELECT $_foo")).toEqual(["_foo"]);
  });

  it("extracts vars with mixed case and digits", () => {
    expect(extractBindVariables("SELECT $camelCase_2")).toEqual([
      "camelCase_2",
    ]);
  });

  it("handles adjacent bind variables", () => {
    expect(extractBindVariables("SELECT $a$b")).toEqual(["a", "b"]);
  });

  it("extracts bind var at very start of input", () => {
    expect(extractBindVariables("$x FROM t")).toEqual(["x"]);
  });

  it("extracts bind var at very end of input", () => {
    expect(extractBindVariables("SELECT $x")).toEqual(["x"]);
  });

  // -- comment nesting edge cases --

  it("does not nest block comments", () => {
    expect(extractBindVariables("SELECT /* a /* b */ $real FROM t")).toEqual([
      "real",
    ]);
  });

  it("treats -- inside a block comment as part of the comment", () => {
    expect(extractBindVariables("SELECT /* -- $nope */ $real FROM t")).toEqual([
      "real",
    ]);
  });

  it("treats /* inside a line comment as part of the comment", () => {
    expect(extractBindVariables("SELECT $real -- /* $nope\nFROM t")).toEqual([
      "real",
    ]);
  });

  // -- preserves order of first appearance --

  it("preserves first-appearance order across many vars", () => {
    expect(extractBindVariables("$c + $a + $b + $a + $c")).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: positional query building (SQLite ? placeholders)
// ---------------------------------------------------------------------------

describe("buildPositionalQuery", () => {
  it("replaces named vars with positional ? placeholders", () => {
    const result = buildPositionalQuery(
      "SELECT * FROM t WHERE a = $foo AND b = $bar",
      ["foo", "bar"],
      { foo: 1, bar: "x" },
    );
    expect(result.sql).toBe("SELECT * FROM t WHERE a = ? AND b = ?");
    expect(result.values).toEqual([1, "x"]);
  });

  it("handles duplicate vars (separate ? with duplicated value)", () => {
    const result = buildPositionalQuery(
      "SELECT * FROM t WHERE a = $x OR b = $x",
      ["x"],
      { x: 42 },
    );
    expect(result.sql).toBe("SELECT * FROM t WHERE a = ? OR b = ?");
    expect(result.values).toEqual([42, 42]);
  });

  it("uses null for missing values", () => {
    const result = buildPositionalQuery("SELECT $missing", ["missing"], {});
    expect(result.values).toEqual([null]);
  });

  // -- string preservation --

  it("preserves strings with escaped quotes", () => {
    const result = buildPositionalQuery(
      "SELECT * FROM t WHERE a = 'it''s' AND b = $x",
      ["x"],
      { x: 1 },
    );
    expect(result.sql).toBe("SELECT * FROM t WHERE a = 'it''s' AND b = ?");
    expect(result.values).toEqual([1]);
  });

  it("does not replace $name inside strings", () => {
    const result = buildPositionalQuery(
      "SELECT * FROM t WHERE a = '$x' AND b = $x",
      ["x"],
      { x: 1 },
    );
    expect(result.sql).toBe("SELECT * FROM t WHERE a = '$x' AND b = ?");
    expect(result.values).toEqual([1]);
  });

  // -- comment preservation --

  it("preserves line comments verbatim", () => {
    const result = buildPositionalQuery(
      "SELECT $x -- $x in comment\nFROM t",
      ["x"],
      { x: 1 },
    );
    expect(result.sql).toBe("SELECT ? -- $x in comment\nFROM t");
    expect(result.values).toEqual([1]);
  });

  it("preserves block comments verbatim", () => {
    const result = buildPositionalQuery(
      "SELECT $x /* $x in comment */ FROM t",
      ["x"],
      { x: 1 },
    );
    expect(result.sql).toBe("SELECT ? /* $x in comment */ FROM t");
    expect(result.values).toEqual([1]);
  });

  // -- var not in bindVars list --

  it("leaves unknown $name unchanged when not in bindVars", () => {
    const result = buildPositionalQuery("SELECT $known, $unknown", ["known"], {
      known: 1,
    });
    // SQLite buildPositionalQuery replaces ALL $name occurrences with ?
    // (the scanner doesn't distinguish known vs unknown — it replaces
    // every $name). Unknown vars get null value.
    expect(result.sql).toBe("SELECT ?, ?");
    expect(result.values).toEqual([1, null]);
  });

  // -- no bind variables --

  it("returns SQL unchanged when there are no bind vars", () => {
    const result = buildPositionalQuery("SELECT 1", [], {});
    expect(result.sql).toBe("SELECT 1");
    expect(result.values).toEqual([]);
  });

  // -- unterminated constructs don't crash --

  it("handles unterminated string without crashing", () => {
    const result = buildPositionalQuery("SELECT 'unterminated $x", ["x"], {
      x: 1,
    });
    // $x is inside the unterminated string, so it's not replaced
    expect(result.sql).toBe("SELECT 'unterminated $x");
    expect(result.values).toEqual([]);
  });

  it("handles unterminated block comment without crashing", () => {
    const result = buildPositionalQuery("SELECT /* unclosed $x", ["x"], {
      x: 1,
    });
    expect(result.sql).toBe("SELECT /* unclosed $x");
    expect(result.values).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: param resolution
// ---------------------------------------------------------------------------

describe("resolveParams", () => {
  it("resolves required params", () => {
    const result = resolveParams(
      [{ name: "x", type: "integer", required: true }],
      { x: "42" },
    );
    expect(result.x).toBe(42);
  });

  it("throws on missing required param", () => {
    expect(() =>
      resolveParams([{ name: "x", type: "integer", required: true }], {}),
    ).toThrow('Required parameter "x" is missing');
  });

  it("uses default for optional params", () => {
    const result = resolveParams(
      [{ name: "x", type: "string", required: false, default: "hello" }],
      {},
    );
    expect(result.x).toBe("hello");
  });

  it("coerces date params as strings", () => {
    const result = resolveParams(
      [{ name: "d", type: "date", required: true }],
      { d: "2024-01-01" },
    );
    expect(result.d).toBe("2024-01-01");
  });

  // --- daterange ---

  // Fixed reference day so the relative-window assertions don't drift.
  const TODAY = Temporal.PlainDate.from("2025-04-15");

  const rangeParam = {
    name: "period",
    type: "daterange" as const,
    required: false,
    fromBind: "start_date",
    toBind: "end_date",
  };

  it("daterange: all_time is the implicit default → both binds NULL", () => {
    const result = resolveParams([rangeParam], {}, TODAY);
    expect(result.start_date).toBeNull();
    expect(result.end_date).toBeNull();
  });

  it("daterange: relative key resolves against today", () => {
    const result = resolveParams(
      [rangeParam],
      { period_relative: "30d" },
      TODAY,
    );
    expect(result.start_date).toBe("2025-03-16");
    expect(result.end_date).toBe("2025-04-15");
  });

  it("daterange: custom with both bounds binds ISO strings", () => {
    const result = resolveParams(
      [rangeParam],
      { period_from: "2024-01-01", period_to: "2024-12-31" },
      TODAY,
    );
    expect(result.start_date).toBe("2024-01-01");
    expect(result.end_date).toBe("2024-12-31");
  });

  it("daterange: custom with open start binds from=null", () => {
    const result = resolveParams(
      [rangeParam],
      { period_to: "2024-12-31" },
      TODAY,
    );
    expect(result.start_date).toBeNull();
    expect(result.end_date).toBe("2024-12-31");
  });

  it("daterange: does NOT expose the param name as a SQL bind", () => {
    const result = resolveParams([rangeParam], {}, TODAY);
    expect("period" in result).toBe(false);
  });

  it("daterange: default override applied when no value supplied", () => {
    const result = resolveParams(
      [{ ...rangeParam, default: relative("7d") }],
      {},
      TODAY,
    );
    expect(result.start_date).toBe("2025-04-08");
    expect(result.end_date).toBe("2025-04-15");
  });

  it("daterange: malformed relative value throws", () => {
    expect(() =>
      resolveParams([rangeParam], { period_relative: "bogus" }, TODAY),
    ).toThrow();
  });
});

describe("report() factory — daterange validation", () => {
  const minimalTree = {
    source: "s",
    levelName: "x",
    columns: [{ name: "a" }],
  };
  const minimalSources = { s: { query: "SELECT 1 AS a" } };

  it("throws when daterange param omits fromBind/toBind", () => {
    expect(() =>
      report({
        name: "r",
        label: "R",
        params: [{ name: "period", type: "daterange", required: false }],
        sources: minimalSources,
        tree: minimalTree,
      }),
    ).toThrow(/must declare both fromBind and toBind/);
  });

  it("throws when fromBind === toBind", () => {
    expect(() =>
      report({
        name: "r",
        label: "R",
        params: [
          {
            name: "period",
            type: "daterange",
            required: false,
            fromBind: "x",
            toBind: "x",
          },
        ],
        sources: minimalSources,
        tree: minimalTree,
      }),
    ).toThrow(/must name distinct SQL bindings/);
  });

  it("throws when two params declare the same SQL bind", () => {
    expect(() =>
      report({
        name: "r",
        label: "R",
        params: [
          { name: "x", type: "integer", required: true },
          {
            name: "period",
            type: "daterange",
            required: false,
            fromBind: "x",
            toBind: "y",
          },
        ],
        sources: minimalSources,
        tree: minimalTree,
      }),
    ).toThrow(/SQL bind name "x" is declared by more than one param/);
  });

  it("accepts a valid daterange param", () => {
    expect(() =>
      report({
        name: "r",
        label: "R",
        params: [
          {
            name: "period",
            type: "daterange",
            required: false,
            fromBind: "start_date",
            toBind: "end_date",
          },
        ],
        sources: minimalSources,
        tree: minimalTree,
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Integration tests: full report execution with SQLite
// ---------------------------------------------------------------------------

describe("executeReport (integration)", () => {
  let sqlite: Database.Database;
  let sql: any;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sql = createReportSqlClient(sqlite);

    // Create accounting schema
    sqlite.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        account_type TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE journals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        narration TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_id INTEGER REFERENCES journals(id) NOT NULL,
        account_id INTEGER REFERENCES accounts(id) NOT NULL,
        debit REAL DEFAULT 0,
        credit REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Seed accounts
    sqlite.exec(`
      INSERT INTO accounts (id, name, account_type) VALUES
        (1, 'Cash', 'Asset'),
        (2, 'Revenue', 'Revenue'),
        (3, 'Rent Expense', 'Expense'),
        (4, 'Owner''s Capital', 'Equity'),
        (5, 'Accounts Payable', 'Liability');
    `);

    // Seed journals and entries
    // J1 (2024-01-15): Cash DR 10,000 / Owner's Capital CR 10,000
    sqlite.exec(`
      INSERT INTO journals (id, date, narration) VALUES
        (1, '2024-01-15', 'Capital contribution');
      INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES
        (1, 1, 10000, 0),
        (1, 4, 0, 10000);
    `);

    // J2 (2024-02-01): Rent Expense DR 1,500 / Cash CR 1,500
    sqlite.exec(`
      INSERT INTO journals (id, date, narration) VALUES
        (2, '2024-02-01', 'Rent payment');
      INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES
        (2, 3, 1500, 0),
        (2, 1, 0, 1500);
    `);

    // J3 (2024-03-01): Cash DR 5,000 / Revenue CR 5,000
    sqlite.exec(`
      INSERT INTO journals (id, date, narration) VALUES
        (3, '2024-03-01', 'Sales');
      INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES
        (3, 1, 5000, 0),
        (3, 2, 0, 5000);
    `);

    // J4 (2024-03-15): Accounts Payable DR 2,000 / Cash CR 2,000
    sqlite.exec(`
      INSERT INTO journals (id, date, narration) VALUES
        (4, '2024-03-15', 'Payment to supplier');
      INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES
        (4, 5, 2000, 0),
        (4, 1, 0, 2000);
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  // -----------------------------------------------------------------------
  // Trial Balance
  // -----------------------------------------------------------------------

  describe("Trial Balance", () => {
    const trialBalance: ReportDefinition = {
      name: "trial-balance",
      label: "Trial Balance",
      params: [
        {
          name: "as_of_date",
          type: "date",
          required: true,
          label: "As of Date",
        },
      ],
      sources: {
        account_types: {
          query: `
            SELECT DISTINCT a.account_type,
              CASE a.account_type
                WHEN 'Asset' THEN 1
                WHEN 'Liability' THEN 2
                WHEN 'Equity' THEN 3
                WHEN 'Revenue' THEN 4
                WHEN 'Expense' THEN 5
              END AS sort_order
            FROM accounts a
            ORDER BY sort_order
          `,
        },
        accounts_by_type: {
          query: `
            SELECT a.id, a.name, a.account_type,
                   COALESCE(SUM(je.debit), 0) AS total_debit,
                   COALESCE(SUM(je.credit), 0) AS total_credit,
                   COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0) AS balance
            FROM accounts a
            LEFT JOIN (
              SELECT je.account_id, je.debit, je.credit
              FROM journal_entries je
              JOIN journals j ON j.id = je.journal_id
              WHERE j.date <= $as_of_date
            ) je ON je.account_id = a.id
            WHERE a.account_type = $account_type
            GROUP BY a.id, a.name, a.account_type
            ORDER BY a.name
          `,
        },
      },
      tree: {
        source: "account_types",
        levelName: "account_type_group",
        columns: [{ name: "account_type", header: "Account Type" }],
        rollup: (children) => ({
          total_debit: children.accounts.reduce(
            (s, n) => s + Number(n.columns.total_debit ?? 0),
            0,
          ),
          total_credit: children.accounts.reduce(
            (s, n) => s + Number(n.columns.total_credit ?? 0),
            0,
          ),
          balance: children.accounts.reduce(
            (s, n) => s + Number(n.columns.balance ?? 0),
            0,
          ),
        }),
        footer: [
          {
            label: "Grand Total",
            compute: (nodes) => ({
              total_debit: nodes.reduce(
                (s, n) => s + Number(n.rollup?.total_debit ?? 0),
                0,
              ),
              total_credit: nodes.reduce(
                (s, n) => s + Number(n.rollup?.total_credit ?? 0),
                0,
              ),
              balance: nodes.reduce(
                (s, n) => s + Number(n.rollup?.balance ?? 0),
                0,
              ),
            }),
          },
        ],
        children: [
          {
            source: "accounts_by_type",
            levelName: "accounts",
            bind: { account_type: "$parent.account_type" },
            columns: [
              { name: "name", header: "Account" },
              {
                name: "total_debit",
                header: "Debit",
                kind: "number",
                displayFormat: "currency",
              },
              {
                name: "total_credit",
                header: "Credit",
                kind: "number",
                displayFormat: "currency",
              },
              {
                name: "balance",
                header: "Balance",
                kind: "number",
                displayFormat: "currency",
              },
            ],
          },
        ],
      },
    };

    it("produces grouped account balances", async () => {
      const result = await executeReport(sql, trialBalance, {
        as_of_date: "2024-12-31",
      });

      expect(result.name).toBe("trial-balance");

      // Data should be pure data nodes (no footers mixed in)
      expect(result.data.length).toBe(5);

      // Footer rows are separate
      expect(result.footerRows).toHaveLength(1);

      // Check Asset group
      const assetGroup = result.data.find(
        (n) => n.columns.account_type === "Asset",
      )!;
      expect(assetGroup).toBeDefined();
      expect(assetGroup.children?.accounts).toHaveLength(1);

      const cash = (assetGroup.children!.accounts as ReportOutputNode[])[0];
      expect(cash.columns.name).toBe("Cash");
      expect(cash.columns.total_debit).toBe(15000);
      expect(cash.columns.total_credit).toBe(3500);
      expect(cash.columns.balance).toBe(11500);

      // Rollup should match
      expect(assetGroup.rollup?.total_debit).toBe(15000);
      expect(assetGroup.rollup?.balance).toBe(11500);
    });

    it("has balanced grand total (debits = credits)", async () => {
      const result = await executeReport(sql, trialBalance, {
        as_of_date: "2024-12-31",
      });

      expect(result.footerRows).toBeDefined();
      expect(result.footerRows![0].label).toBe("Grand Total");
      expect(result.footerRows![0].columns.total_debit).toBe(
        result.footerRows![0].columns.total_credit,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Account Ledger
  // -----------------------------------------------------------------------

  describe("Account Ledger", () => {
    const accountLedger: ReportDefinition = {
      name: "account-ledger",
      label: "Account Ledger",
      params: [
        { name: "account_id", type: "integer", required: true },
        { name: "from_date", type: "date", required: true },
        { name: "to_date", type: "date", required: true },
      ],
      sources: {
        account_info: {
          query: `SELECT id, name, account_type FROM accounts WHERE id = $account_id`,
        },
        opening_balance: {
          query: `
            SELECT COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0) AS opening_balance
            FROM journal_entries je
            JOIN journals j ON j.id = je.journal_id
            WHERE je.account_id = $account_id AND j.date < $from_date
          `,
        },
        transactions: {
          query: `
            SELECT je.id, j.date, j.narration,
                   je.debit, je.credit
            FROM journal_entries je
            JOIN journals j ON j.id = je.journal_id
            WHERE je.account_id = $account_id
              AND j.date >= $from_date
              AND j.date <= $to_date
            ORDER BY j.date, j.id
          `,
        },
      },
      tree: {
        source: "account_info",
        levelName: "account",
        columns: [
          { name: "name", header: "Account Name" },
          { name: "account_type", header: "Account Type" },
        ],
        children: [
          {
            source: "opening_balance",
            levelName: "opening",
            singular: true,
            bind: { account_id: "$parent.id" },
            columns: [
              {
                name: "opening_balance",
                header: "Opening Balance",
                kind: "number",
                displayFormat: "currency",
              },
            ],
          },
          {
            source: "transactions",
            levelName: "entries",
            bind: { account_id: "$parent.id" },
            columns: [
              { name: "date", header: "Date", kind: "date" },
              { name: "narration", header: "Narration" },
              {
                name: "debit",
                header: "Debit",
                kind: "number",
                displayFormat: "currency",
              },
              {
                name: "credit",
                header: "Credit",
                kind: "number",
                displayFormat: "currency",
              },
              {
                name: "balance",
                header: "Balance",
                kind: "number",
                displayFormat: "currency",
              },
            ],
            transform: (nodes, context) => {
              const opening = context.siblings
                .opening as ReportOutputNode | null;
              let balance = Number(opening?.columns.opening_balance ?? 0);
              for (const node of nodes) {
                balance +=
                  Number(node.columns.debit ?? 0) -
                  Number(node.columns.credit ?? 0);
                node.columns.balance = balance;
              }
              return nodes;
            },
            footer: [
              {
                label: "Closing Balance",
                compute: (nodes) => {
                  const last = nodes[nodes.length - 1];
                  return { balance: last?.columns.balance ?? 0 };
                },
              },
            ],
          },
        ],
      },
    };

    it("computes running balance for Cash account", async () => {
      const result = await executeReport(sql, accountLedger, {
        account_id: 1,
        from_date: "2024-01-01",
        to_date: "2024-12-31",
      });

      expect(result.data).toHaveLength(1);
      const account = result.data[0];
      expect(account.columns.name).toBe("Cash");

      // Opening balance should be 0 (no transactions before 2024-01-01)
      const opening = account.children!.opening as ReportOutputNode;
      expect(opening.columns.opening_balance).toBe(0);

      // Should have 4 entries (from 4 journals touching Cash) — pure data, no footers
      const entries = account.children!.entries as ReportOutputNode[];
      expect(entries).toHaveLength(4);

      // Check running balance
      // J1: +10,000 → balance 10,000
      expect(entries[0].columns.debit).toBe(10000);
      expect(entries[0].columns.balance).toBe(10000);

      // J2: -1,500 → balance 8,500
      expect(entries[1].columns.credit).toBe(1500);
      expect(entries[1].columns.balance).toBe(8500);

      // J3: +5,000 → balance 13,500
      expect(entries[2].columns.debit).toBe(5000);
      expect(entries[2].columns.balance).toBe(13500);

      // J4: -2,000 → balance 11,500
      expect(entries[3].columns.credit).toBe(2000);
      expect(entries[3].columns.balance).toBe(11500);
    });

    it("footer shows closing balance", async () => {
      const result = await executeReport(sql, accountLedger, {
        account_id: 1,
        from_date: "2024-01-01",
        to_date: "2024-12-31",
      });

      const account = result.data[0];
      const childFooters = account.childFooterRows!.entries;
      expect(childFooters).toHaveLength(1);
      expect(childFooters[0].label).toBe("Closing Balance");
      expect(childFooters[0].columns.balance).toBe(11500);
    });

    it("uses opening balance from prior period", async () => {
      // Query from March onwards — opening should include Jan + Feb
      const result = await executeReport(sql, accountLedger, {
        account_id: 1,
        from_date: "2024-03-01",
        to_date: "2024-12-31",
      });

      const opening = result.data[0].children!.opening as ReportOutputNode;
      // Cash before March: +10,000 (J1) - 1,500 (J2) = 8,500
      expect(opening.columns.opening_balance).toBe(8500);

      // Pure data entries, no footers mixed in
      const entries = result.data[0].children!.entries as ReportOutputNode[];

      // First entry should start from 8,500 opening
      // J3: +5,000 → 13,500
      expect(entries[0].columns.balance).toBe(13500);
      // J4: -2,000 → 11,500
      expect(entries[1].columns.balance).toBe(11500);
    });
  });

  // -----------------------------------------------------------------------
  // Balance Sheet
  // -----------------------------------------------------------------------

  describe("Balance Sheet", () => {
    const balanceSheet: ReportDefinition = {
      name: "balance-sheet",
      label: "Balance Sheet",
      params: [{ name: "as_of_date", type: "date", required: true }],
      sources: {
        sections: {
          // SQLite doesn't have unnest(ARRAY[...]) — use UNION ALL SELECTs
          query: `
            SELECT 'Asset' AS section, 1 AS sort_order
            UNION ALL SELECT 'Liability', 2
            UNION ALL SELECT 'Equity', 3
            ORDER BY sort_order
          `,
        },
        section_accounts: {
          query: `
            SELECT a.id, a.name,
                   CASE WHEN $section IN ('Liability', 'Equity')
                        THEN COALESCE(SUM(je.credit), 0) - COALESCE(SUM(je.debit), 0)
                        ELSE COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)
                   END AS balance
            FROM accounts a
            LEFT JOIN (
              SELECT je.account_id, je.debit, je.credit
              FROM journal_entries je
              JOIN journals j ON j.id = je.journal_id
              WHERE j.date <= $as_of_date
            ) je ON je.account_id = a.id
            WHERE a.account_type = $section
            GROUP BY a.id, a.name
            HAVING COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0) != 0
            ORDER BY a.name
          `,
        },
      },
      tree: {
        source: "sections",
        levelName: "section",
        columns: [{ name: "section", header: "Section" }],
        rollup: (children) => ({
          section_total: children.accounts.reduce(
            (s, n) => s + Number(n.columns.balance ?? 0),
            0,
          ),
        }),
        footer: [
          {
            label: "Total Liabilities + Equity",
            compute: (nodes) => {
              const liabilities = nodes.find(
                (n) => n.columns.section === "Liability",
              );
              const equity = nodes.find((n) => n.columns.section === "Equity");
              return {
                section_total:
                  Number(liabilities?.rollup?.section_total ?? 0) +
                  Number(equity?.rollup?.section_total ?? 0),
              };
            },
          },
        ],
        children: [
          {
            source: "section_accounts",
            levelName: "accounts",
            bind: { section: "$parent.section" },
            columns: [
              { name: "name", header: "Account" },
              {
                name: "balance",
                header: "Balance",
                kind: "number",
                displayFormat: "currency",
              },
            ],
          },
        ],
      },
    };

    it("shows three sections with correct balances", async () => {
      const result = await executeReport(sql, balanceSheet, {
        as_of_date: "2024-12-31",
      });

      // Pure data — no footers mixed in
      expect(result.data).toHaveLength(3);

      const asset = result.data.find((n) => n.columns.section === "Asset")!;
      expect(asset.rollup?.section_total).toBe(11500); // Cash: 11,500

      const liability = result.data.find(
        (n) => n.columns.section === "Liability",
      )!;
      // AP: J4 debit=2000, no credits → credit-normal sign: 0-2000 = -2000
      expect(liability.rollup?.section_total).toBe(-2000);

      const equity = result.data.find((n) => n.columns.section === "Equity")!;
      // Owner's Capital: J1 credit=10000, no debits → credit-normal sign: 10000-0 = 10000
      expect(equity.rollup?.section_total).toBe(10000);
    });

    it("excludes zero-balance accounts", async () => {
      const result = await executeReport(sql, balanceSheet, {
        as_of_date: "2024-12-31",
      });

      const asset = result.data.find((n) => n.columns.section === "Asset")!;
      const accounts = asset.children!.accounts as ReportOutputNode[];
      // Only Cash should appear (the only Asset account with non-zero balance)
      expect(accounts).toHaveLength(1);
      expect(accounts[0].columns.name).toBe("Cash");
    });

    it("footer shows total liabilities + equity", async () => {
      const result = await executeReport(sql, balanceSheet, {
        as_of_date: "2024-12-31",
      });

      expect(result.footerRows).toBeDefined();
      expect(result.footerRows![0].label).toBe("Total Liabilities + Equity");
      // L + E = -2000 + 10000 = 8000
      expect(result.footerRows![0].columns.section_total).toBe(8000);
    });
  });

  // -----------------------------------------------------------------------
  // Root-level transforms
  // -----------------------------------------------------------------------

  describe("Root-level transforms", () => {
    const netWorthOverTime: ReportDefinition = {
      name: "net-worth-over-time",
      label: "Net Worth Over Time",
      params: [],
      sources: {
        monthly_deltas: {
          query: `
            SELECT
              strftime('%Y-%m', j.date) AS month,
              COALESCE(SUM(CASE WHEN a.account_type = 'Asset' THEN je.debit - je.credit ELSE 0 END), 0) AS asset_delta,
              COALESCE(SUM(CASE WHEN a.account_type = 'Liability' THEN je.debit - je.credit ELSE 0 END), 0) AS liability_delta
            FROM journals j
            JOIN journal_entries je ON je.journal_id = j.id
            JOIN accounts a ON a.id = je.account_id
            GROUP BY strftime('%Y-%m', j.date)
            ORDER BY month
          `,
        },
      },
      tree: {
        source: "monthly_deltas",
        levelName: "month_row",
        columns: [
          { name: "month", header: "Month" },
          {
            name: "asset_delta",
            header: "Asset Delta",
            kind: "number",
            displayFormat: "currency",
          },
          {
            name: "liability_delta",
            header: "Liability Delta",
            kind: "number",
            displayFormat: "currency",
          },
          {
            name: "assets",
            header: "Assets",
            kind: "number",
            displayFormat: "currency",
          },
          {
            name: "liabilities",
            header: "Liabilities",
            kind: "number",
            displayFormat: "currency",
          },
          {
            name: "net_worth",
            header: "Net Worth",
            kind: "number",
            displayFormat: "currency",
          },
        ],
        transform: (nodes) => {
          let assets = 0;
          let liabilities = 0;
          for (const node of nodes) {
            assets += Number(node.columns.asset_delta ?? 0);
            liabilities += Number(node.columns.liability_delta ?? 0);
            node.columns.assets = assets;
            node.columns.liabilities = liabilities;
            node.columns.net_worth = assets - liabilities;
          }
          return nodes;
        },
      },
    };

    it("computes cumulative virtual columns at root level", async () => {
      const result = await executeReport(sql, netWorthOverTime, {});

      expect(result.data).toHaveLength(3); // Jan, Feb, Mar

      // Jan: Cash DR 10000 → asset_delta=10000, liability_delta=0
      const jan = result.data[0];
      expect(jan.columns.month).toBe("2024-01");
      expect(jan.columns.assets).toBe(10000);
      expect(jan.columns.liabilities).toBe(0);
      expect(jan.columns.net_worth).toBe(10000);

      // Feb: Cash CR 1500 → asset_delta=-1500, liability_delta=0
      const feb = result.data[1];
      expect(feb.columns.month).toBe("2024-02");
      expect(feb.columns.assets).toBe(8500);
      expect(feb.columns.liabilities).toBe(0);
      expect(feb.columns.net_worth).toBe(8500);

      // Mar: Cash DR 5000+CR 2000 → asset_delta=3000; AP DR 2000 → liability_delta=2000
      const mar = result.data[2];
      expect(mar.columns.month).toBe("2024-03");
      expect(mar.columns.assets).toBe(11500);
      expect(mar.columns.liabilities).toBe(2000);
      expect(mar.columns.net_worth).toBe(9500);
    });

    it("root-level transform receives synthetic context with params", async () => {
      let capturedContext: any = null;

      const reportWithParamCheck: ReportDefinition = {
        name: "param-check",
        label: "Param Check",
        params: [{ name: "as_of_date", type: "date", required: true }],
        sources: {
          items: { query: "SELECT id, name FROM accounts ORDER BY id LIMIT 1" },
        },
        tree: {
          source: "items",
          levelName: "item",
          columns: [{ name: "name" }],
          transform: (nodes, context) => {
            capturedContext = context;
            return nodes;
          },
        },
      };

      await executeReport(sql, reportWithParamCheck, {
        as_of_date: "2024-12-31",
      });

      expect(capturedContext).not.toBeNull();
      expect(capturedContext.parent.levelName).toBe("__root__");
      expect(capturedContext.parent.columns).toEqual({});
      expect(capturedContext.siblings).toEqual({});
      expect(capturedContext.params.as_of_date).toBe("2024-12-31");
    });

    it("root-level transform works with footer", async () => {
      const netWorthWithFooter: ReportDefinition = {
        ...netWorthOverTime,
        name: "net-worth-with-footer",
        tree: {
          ...netWorthOverTime.tree,
          footer: [
            {
              label: "Current",
              compute: (nodes) => {
                const last = nodes[nodes.length - 1];
                return {
                  assets: last?.columns.assets ?? 0,
                  liabilities: last?.columns.liabilities ?? 0,
                  net_worth: last?.columns.net_worth ?? 0,
                };
              },
            },
          ],
        },
      };

      const result = await executeReport(sql, netWorthWithFooter, {});

      expect(result.footerRows).toBeDefined();
      expect(result.footerRows).toHaveLength(1);
      expect(result.footerRows![0].label).toBe("Current");

      // Footer should see the transform's virtual columns from the last row (Mar)
      expect(result.footerRows![0].columns.assets).toBe(11500);
      expect(result.footerRows![0].columns.liabilities).toBe(2000);
      expect(result.footerRows![0].columns.net_worth).toBe(9500);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("Edge cases", () => {
    it("handles empty results gracefully", async () => {
      const emptyReport: ReportDefinition = {
        name: "empty",
        label: "Empty Report",
        params: [],
        sources: {
          nothing: {
            query: "SELECT * FROM accounts WHERE 1 = 0",
          },
        },
        tree: {
          source: "nothing",
          levelName: "item",
          columns: [{ name: "name" }],
        },
      };

      const result = await executeReport(sql, emptyReport, {});
      expect(result.data).toEqual([]);
    });

    it("collects errors for missing sources", async () => {
      const badReport: ReportDefinition = {
        name: "bad",
        label: "Bad Report",
        params: [],
        sources: {},
        tree: {
          source: "nonexistent",
          levelName: "item",
          columns: [{ name: "name" }],
        },
      };

      const result = await executeReport(sql, badReport, {});
      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain("not found");
    });

    it("handles date boundary conditions", async () => {
      // Only include journals up to 2024-01-15
      const trialBalance: ReportDefinition = {
        name: "tb",
        label: "TB",
        params: [{ name: "as_of_date", type: "date", required: true }],
        sources: {
          accounts: {
            query: `
              SELECT a.id, a.name,
                     COALESCE(SUM(je.debit), 0) AS total_debit,
                     COALESCE(SUM(je.credit), 0) AS total_credit
              FROM accounts a
              LEFT JOIN (
                SELECT je.account_id, je.debit, je.credit
                FROM journal_entries je
                JOIN journals j ON j.id = je.journal_id
                WHERE j.date <= $as_of_date
              ) je ON je.account_id = a.id
              GROUP BY a.id, a.name
              ORDER BY a.name
            `,
          },
        },
        tree: {
          source: "accounts",
          levelName: "account",
          columns: [
            { name: "name" },
            { name: "total_debit" },
            { name: "total_credit" },
          ],
        },
      };

      const result = await executeReport(sql, trialBalance, {
        as_of_date: "2024-01-15",
      });

      // Only J1 should be included
      const cash = result.data.find((n) => n.columns.name === "Cash")!;
      expect(cash.columns.total_debit).toBe(10000);
      expect(cash.columns.total_credit).toBe(0);
    });

    it("when condition skips children", async () => {
      const reportDef: ReportDefinition = {
        name: "conditional",
        label: "Conditional",
        params: [],
        sources: {
          items: { query: "SELECT id, name FROM accounts ORDER BY id LIMIT 2" },
          details: { query: "SELECT 'detail' AS info WHERE 1 = 1" },
        },
        tree: {
          source: "items",
          levelName: "item",
          columns: [{ name: "name" }],
          children: [
            {
              source: "details",
              levelName: "detail",
              // Only show details for account id 1
              when: (parent) => parent.id === 1,
              columns: [{ name: "info" }],
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      // First item (id=1) should have detail
      expect(result.data[0].children!.detail).toHaveLength(1);
      // Second item (id=2) should have empty detail
      expect(result.data[1].children!.detail).toHaveLength(0);
    });

    it("transform receives rawRows with undeclared SQL columns", async () => {
      let capturedRawRows: Record<string, unknown>[] = [];

      const reportDef: ReportDefinition = {
        name: "raw-rows",
        label: "Raw Rows",
        params: [],
        sources: {
          items: { query: "SELECT 1 AS id, 'Root' AS name" },
          // SQL returns id, name, extra_col — but columns[] only declares name
          details: {
            query:
              "SELECT id, name, account_type AS extra_col FROM accounts ORDER BY id LIMIT 2",
          },
        },
        tree: {
          source: "items",
          levelName: "root",
          columns: [{ name: "name" }],
          children: [
            {
              source: "details",
              levelName: "detail",
              columns: [{ name: "name" }],
              transform: (nodes, context) => {
                capturedRawRows = context.rawRows;
                return nodes;
              },
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      // No warning errors — undeclared columns are no longer flagged
      expect(result.errors).toBeUndefined();

      // rawRows should contain ALL SQL columns, including undeclared ones
      expect(capturedRawRows).toHaveLength(2);
      expect(capturedRawRows[0]).toHaveProperty("id");
      expect(capturedRawRows[0]).toHaveProperty("name");
      expect(capturedRawRows[0]).toHaveProperty("extra_col");
    });

    it("warns when rollup keys are not declared in columns[]", async () => {
      const reportDef: ReportDefinition = {
        name: "rollup-warn",
        label: "Rollup Warn",
        params: [],
        sources: {
          parents: { query: "SELECT 'Group A' AS name" },
          kids: { query: "SELECT id, name FROM accounts ORDER BY id LIMIT 2" },
        },
        tree: {
          source: "parents",
          levelName: "group",
          // Only declares "name" — not "total" which rollup produces
          columns: [{ name: "name" }],
          rollup: (children) => ({
            total: children.item.reduce(
              (s, n) => s + Number(n.columns.id ?? 0),
              0,
            ),
          }),
          children: [
            {
              source: "kids",
              levelName: "item",
              columns: [{ name: "id" }, { name: "name" }],
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      expect(result.errors).toBeDefined();
      const warning = result.errors!.find((e) =>
        e.message.includes("Rollup produces keys"),
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("total");
      expect(warning!.message).toContain("columns[]");
    });

    it("warns when footer keys are not declared in columns[]", async () => {
      const reportDef: ReportDefinition = {
        name: "footer-warn",
        label: "Footer Warn",
        params: [],
        sources: {
          items: { query: "SELECT id, name FROM accounts ORDER BY id LIMIT 2" },
        },
        tree: {
          source: "items",
          levelName: "item",
          // Only declares "name" — not "grand_total" which footer produces
          columns: [{ name: "name" }],
          footer: [
            {
              label: "Grand Total",
              compute: (nodes) => ({
                grand_total: nodes.length,
              }),
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      expect(result.errors).toBeDefined();
      const warning = result.errors!.find((e) =>
        e.message.includes('Footer "Grand Total"'),
      );
      expect(warning).toBeDefined();
      expect(warning!.message).toContain("grand_total");
      expect(warning!.message).toContain("columns[]");
    });

    it("singular children produce object or null", async () => {
      const reportDef: ReportDefinition = {
        name: "singular",
        label: "Singular",
        params: [],
        sources: {
          items: { query: "SELECT id, name FROM accounts WHERE id = 1" },
          info: { query: "SELECT 'extra' AS info" },
          empty: { query: "SELECT 'x' AS val WHERE 1 = 0" },
        },
        tree: {
          source: "items",
          levelName: "item",
          columns: [{ name: "name" }],
          children: [
            {
              source: "info",
              levelName: "extra",
              singular: true,
              columns: [{ name: "info" }],
            },
            {
              source: "empty",
              levelName: "missing",
              singular: true,
              columns: [{ name: "val" }],
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      const item = result.data[0];
      // Singular with result → object
      expect(item.children!.extra).toBeDefined();
      expect((item.children!.extra as ReportOutputNode).columns.info).toBe(
        "extra",
      );
      // Singular with no result → null
      expect(item.children!.missing).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Display functions
  // -----------------------------------------------------------------------

  describe("Display functions", () => {
    it("column display function formats output values", async () => {
      const reportDef: ReportDefinition = {
        name: "display-basic",
        label: "Display Basic",
        params: [],
        sources: {
          items: {
            query:
              "SELECT id, name, account_type FROM accounts ORDER BY id LIMIT 2",
          },
        },
        tree: {
          source: "items",
          levelName: "item",
          columns: [
            {
              name: "name",
              header: "Name",
              display: (row) => `${row.name} (${row.account_type})`,
            },
            { name: "account_type", header: "Type" },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      expect(result.data).toHaveLength(2);
      // display formatted the name column using data from both columns
      expect(result.data[0].columns.name).toBe("Cash (Asset)");
      expect(result.data[1].columns.name).toBe("Revenue (Revenue)");
      // account_type without display is unchanged
      expect(result.data[0].columns.account_type).toBe("Asset");
    });

    it("display receives undeclared SQL columns", async () => {
      const reportDef: ReportDefinition = {
        name: "display-undeclared",
        label: "Display Undeclared",
        params: [],
        sources: {
          items: {
            query: "SELECT id, name, account_type FROM accounts WHERE id = 1",
          },
        },
        tree: {
          source: "items",
          levelName: "item",
          columns: [
            {
              name: "name",
              header: "Name",
              display: (row) => `${row.name} [${row.account_type}]`,
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      expect(result.data[0].columns.name).toBe("Cash [Asset]");
    });

    it("display runs after rollup — rollup sees raw values, not display strings", async () => {
      const reportDef: ReportDefinition = {
        name: "display-after-rollup",
        label: "Display After Rollup",
        params: [],
        sources: {
          groups: { query: "SELECT 'Assets' AS section" },
          items: {
            query: `
              SELECT a.name,
                     COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0) AS balance
              FROM accounts a
              LEFT JOIN journal_entries je ON je.account_id = a.id
              WHERE a.account_type = 'Asset'
              GROUP BY a.name
            `,
          },
        },
        tree: {
          source: "groups",
          levelName: "group",
          columns: [
            { name: "section" },
            {
              name: "total",
              header: "Total",
              display: (row) => `$${Number(row.total).toLocaleString()}`,
            },
          ],
          rollup: (children) => ({
            total: children.item.reduce(
              (s, n) => s + Number(n.columns.balance ?? 0),
              0,
            ),
          }),
          children: [
            {
              source: "items",
              levelName: "item",
              columns: [
                { name: "name" },
                {
                  name: "balance",
                  display: (row) => `$${Number(row.balance).toLocaleString()}`,
                },
              ],
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      const group = result.data[0];

      // Rollup computed correctly from raw numeric values
      expect(group.rollup?.total).toBe(11500);

      // Display formatted the rollup value on the group
      expect(group.columns.total).toBe("$11,500");

      // Child display also formatted
      const items = group.children!.item as ReportOutputNode[];
      expect(items[0].columns.balance).toBe("$11,500");
    });

    it("display applies to footer rows", async () => {
      const reportDef: ReportDefinition = {
        name: "display-footer",
        label: "Display Footer",
        params: [],
        sources: {
          items: { query: "SELECT id, name FROM accounts ORDER BY id LIMIT 3" },
        },
        tree: {
          source: "items",
          levelName: "item",
          columns: [
            { name: "name" },
            {
              name: "count",
              header: "Count",
              display: (row) => `${row.count} items`,
            },
          ],
          footer: [
            {
              label: "Total",
              compute: (nodes) => ({
                count: nodes.length,
              }),
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      expect(result.footerRows).toHaveLength(1);
      expect(result.footerRows![0].columns.count).toBe("3 items");
    });

    it("display applies to child footer rows", async () => {
      const reportDef: ReportDefinition = {
        name: "display-child-footer",
        label: "Display Child Footer",
        params: [],
        sources: {
          parents: { query: "SELECT 1 AS id, 'Group' AS name" },
          kids: { query: "SELECT id, name FROM accounts ORDER BY id LIMIT 3" },
        },
        tree: {
          source: "parents",
          levelName: "group",
          columns: [{ name: "name" }],
          children: [
            {
              source: "kids",
              levelName: "item",
              columns: [
                { name: "name" },
                {
                  name: "total",
                  header: "Total",
                  display: (row) =>
                    row.total != null ? `${row.total} accounts` : null,
                },
              ],
              footer: [
                {
                  label: "Count",
                  compute: (nodes) => ({ total: nodes.length }),
                },
              ],
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      const group = result.data[0];
      const childFooters = group.childFooterRows!.item;
      expect(childFooters).toHaveLength(1);
      expect(childFooters[0].columns.total).toBe("3 accounts");
    });

    it("rowLinks and column.links round-trip through executeReport", async () => {
      const reportDef: ReportDefinition = {
        name: "links",
        label: "Links",
        params: [],
        sources: {
          accts: {
            query:
              "SELECT id, name, account_type FROM accounts ORDER BY id LIMIT 3",
          },
        },
        tree: {
          source: "accts",
          levelName: "account",
          columns: [
            { name: "id" },
            {
              name: "name",
              links: [
                {
                  kind: "table",
                  table: "accounts",
                  bind: { id: "id" },
                  label: "Open",
                },
              ],
            },
            { name: "account_type" },
          ],
          rowLinks: [
            {
              kind: "report",
              report: "account-ledger",
              bind: { account_id: "id" },
              label: "Ledger",
              icon: "drill-into",
            },
          ],
        },
      };

      const result = await executeReport(sql, reportDef, {});

      // Row-level links surface on the flat map keyed by levelName,
      // carrying the icon hint through unchanged.
      expect(result.levelLinks).toBeDefined();
      expect(result.levelLinks!.account).toHaveLength(1);
      expect(result.levelLinks!.account[0]).toEqual({
        kind: "report",
        report: "account-ledger",
        bind: { account_id: "id" },
        label: "Ledger",
        icon: "drill-into",
      });

      // Column-level links ride on the columns as declared
      const nameCol = result.levelColumns.account.find(
        (c) => c.name === "name",
      );
      expect(nameCol?.links).toHaveLength(1);
      expect(nameCol?.links![0]).toMatchObject({
        kind: "table",
        table: "accounts",
        bind: { id: "id" },
      });
    });

    it("__rawRow is cleaned up from output nodes", async () => {
      const reportDef: ReportDefinition = {
        name: "no-raw-row-leak",
        label: "No Raw Row Leak",
        params: [],
        sources: {
          items: { query: "SELECT id, name FROM accounts ORDER BY id LIMIT 1" },
        },
        tree: {
          source: "items",
          levelName: "item",
          columns: [{ name: "name" }],
        },
      };

      const result = await executeReport(sql, reportDef, {});
      // __rawRow must not leak into the output
      expect((result.data[0] as any).__rawRow).toBeUndefined();
    });
  });
});
