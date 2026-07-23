import { describe, expect, it } from "vitest";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sapportaTable } from "../schema/table.js";
import { createTableCatalog } from "../schema/catalog.js";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import { scopedRows } from "../data/scoped-rows.js";
import { buildSearchPredicate } from "./search-sql.js";

const authorsTable = sqliteTable("authors", {
  id: integer("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
});

const booksTable = sqliteTable("books", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  author_id: integer("author_id")
    .notNull()
    .references(() => authorsTable.id),
  private_note: text("private_note"),
});

const quotesTable = sqliteTable(
  "quotes",
  {
    id: integer("id").primaryKey(),
    workspace_id: text("workspace_id").notNull(),
    book_id: integer("book_id")
      .notNull()
      .references(() => booksTable.id),
    quote_text: text("quote_text").notNull(),
  },
  (table) => [index("quotes_book_id_idx").on(table.book_id)],
);

const authors = sapportaTable({
  drizzle: authorsTable,
  meta: {
    rowScope: "workspaceGlobal",
    rowLabelColumns: ["first_name", "last_name"],
  },
});

const books = sapportaTable({
  drizzle: booksTable,
  meta: {
    rowScope: "systemGlobal",
    rowLabelColumns: ["title"],
    columns: {
      private_note: { visuallyHidden: true },
    },
    children: [{ table: "quotes", foreignKey: "book_id" }],
    search: {
      children: {
        quotes: "allColumns",
      },
    },
  },
});

const quotes = sapportaTable({
  drizzle: quotesTable,
  meta: {
    rowScope: "workspaceGlobal",
    rowLabelColumns: ["quote_text"],
  },
});

function setup() {
  const { db, sqlite } = createTestDb();
  sqlite.exec(`
    CREATE TABLE authors (
      id INTEGER PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL
    );
    CREATE TABLE books (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES authors(id),
      private_note TEXT
    );
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      book_id INTEGER NOT NULL REFERENCES books(id),
      quote_text TEXT NOT NULL
    );
    CREATE INDEX quotes_book_id_idx ON quotes(book_id);

    INSERT INTO authors VALUES
      (7001, 'workspace-1', 'Jane', 'Doe'),
      (7002, 'workspace-2', 'Octavia', 'Butler');
    INSERT INTO books VALUES
      (101, 'Blue Horizon', 7001, 'hidden-cipher'),
      (102, 'Kindred', 7002, 'not-public'),
      (103, '100%_literal\\path', 7001, NULL),
      (104, '100XXliteral\\path', 7001, NULL);
    INSERT INTO quotes VALUES
      (1, 'workspace-1', 101, 'The sea remembers blue.'),
      (2, 'workspace-1', 101, 'Blue appears twice.'),
      (3, 'workspace-2', 102, 'scope-secret phrase');
  `);
  const catalog = createTableCatalog([authors, books, quotes]);
  const auth = createTestAuthContext({ tables: catalog.tables });
  return {
    db,
    sqlite,
    catalog,
    auth,
    rows: scopedRows(db, auth, books, {
      searchPlan: catalog.searchPlanFor("books"),
    }),
  };
}

describe("explicit relational table search", () => {
  it("searches root values, FK row labels, and explicitly configured quotes", async () => {
    const { rows } = setup();

    await expect(rows.list({ q: "Horizon" })).resolves.toMatchObject({
      data: [{ id: 101 }],
      meta: { total: 1 },
    });
    await expect(rows.list({ q: "Jane Doe" })).resolves.toMatchObject({
      data: [{ id: 101 }, { id: 103 }, { id: 104 }],
      meta: { total: 3 },
    });
    await expect(rows.list({ q: "sea remembers" })).resolves.toMatchObject({
      data: [{ id: 101 }],
      meta: { total: 1 },
    });
  });

  it("does not search raw FK ids or visually hidden columns", async () => {
    const { rows } = setup();

    await expect(rows.list({ q: "7002" })).resolves.toMatchObject({
      data: [],
      meta: { total: 0 },
    });
    await expect(rows.list({ q: "hidden-cipher" })).resolves.toMatchObject({
      data: [],
      meta: { total: 0 },
    });
  });

  it("treats LIKE syntax literally and does not duplicate matching roots", async () => {
    const { rows } = setup();

    const literal = await rows.list({ q: "%_" });
    expect(literal.data.map((row) => row.id)).toEqual([103]);

    const duplicateMatches = await rows.list({ q: "blue" });
    expect(duplicateMatches.data.map((row) => row.id)).toEqual([101]);
    expect(duplicateMatches.meta.total).toBe(1);
    await expect(rows.exportRows({ q: "blue" })).resolves.toHaveLength(1);
  });

  it("applies child row scope and omits unreadable relationship branches", async () => {
    const { db, rows, auth, catalog } = setup();

    await expect(rows.list({ q: "scope-secret" })).resolves.toMatchObject({
      data: [],
      meta: { total: 0 },
    });
    await expect(rows.list({ q: "Octavia Butler" })).resolves.toMatchObject({
      data: [],
      meta: { total: 0 },
    });

    const noQuoteRead = {
      ...auth,
      ability: {
        can(action: string, subject: string) {
          return action === "read" && subject !== "quotes";
        },
      },
    };
    const unreadableRows = scopedRows(db, noQuoteRead, books, {
      searchPlan: catalog.searchPlanFor("books"),
    });
    await expect(
      unreadableRows.list({ q: "sea remembers" }),
    ).resolves.toMatchObject({
      data: [],
      meta: { total: 0 },
    });

    const noAuthorRead = {
      ...auth,
      ability: {
        can(action: string, subject: string) {
          return action === "read" && subject !== "authors";
        },
      },
    };
    const unreadableLabels = scopedRows(db, noAuthorRead, books, {
      searchPlan: catalog.searchPlanFor("books"),
    });
    await expect(
      unreadableLabels.list({ q: "Jane Doe" }),
    ).resolves.toMatchObject({
      data: [],
      meta: { total: 0 },
    });
  });

  it("uses the child foreign-key index for the correlated relationship", () => {
    const { db, sqlite, auth, catalog } = setup();
    const predicate = buildSearchPredicate(
      catalog.searchPlanFor("books"),
      "blue",
      auth,
    );
    const query = db.select().from(booksTable).where(predicate).toSQL();
    const details = sqlite
      .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
      .all(...query.params) as Array<{ detail: string }>;

    expect(details.map((row) => row.detail).join("\n")).toMatch(
      /quotes_book_id_idx/,
    );
  });
});
