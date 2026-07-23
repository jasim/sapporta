import { describe, expect, it } from "vitest";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createTableCatalog } from "../schema/catalog.js";
import { sapportaTable } from "../schema/table.js";
import { normalizeTableSearch, type TableSearch } from "./search-types.js";
import { SearchPlanValidationError } from "./search-plan.js";

describe("table search normalization", () => {
  it("defaults omitted search and object self values to allColumns", () => {
    const booksTable = sqliteTable("books", {
      id: integer("id").primaryKey(),
      title: text("title").notNull(),
    });
    const books = sapportaTable({
      drizzle: booksTable,
      meta: {
        rowLabelColumns: ["title"],
        children: [{ table: "quotes", foreignKey: "book_id" }],
        search: { children: { quotes: "allColumns" } },
      },
    });

    expect(
      sapportaTable({
        drizzle: booksTable,
        meta: { rowLabelColumns: ["title"] },
      }).meta.search,
    ).toBe("allColumns");
    expect(books.meta.search).toEqual({
      self: "allColumns",
      children: { quotes: "allColumns" },
    });
    expect(normalizeTableSearch(false)).toBe(false);
    expect(normalizeTableSearch({ self: false })).toEqual({
      self: false,
      children: {},
    });
  });

  it("rejects empty self arrays and cyclic configuration objects", () => {
    expect(() => normalizeTableSearch({ self: [] })).toThrow(/Use self: false/);

    const cycle: {
      self: false;
      children: Record<string, TableSearch>;
    } = { self: false, children: {} };
    cycle.children.quotes = cycle;
    expect(() => normalizeTableSearch(cycle)).toThrow(/cyclic/i);
  });
});

describe("search plan compilation", () => {
  function schema(options?: {
    search?: TableSearch;
    quoteIndex?: boolean;
    logicalReference?: boolean;
  }) {
    const booksTable = sqliteTable("books", {
      id: integer("id").primaryKey(),
      title: text("title").notNull(),
      workspace_id: text("workspace_id"),
      internal_code: text("internal_code"),
    });
    const quotesTable = sqliteTable(
      "quotes",
      {
        id: integer("id").primaryKey(),
        book_id: options?.logicalReference
          ? integer("book_id").notNull()
          : integer("book_id")
              .notNull()
              .references(() => booksTable.id),
        quote_text: text("quote_text").notNull(),
      },
      (table) =>
        options?.quoteIndex
          ? [index("quotes_book_id_idx").on(table.book_id)]
          : [],
    );
    const books = sapportaTable({
      drizzle: booksTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["title"],
        columns: { internal_code: { visuallyHidden: true } },
        children: [{ table: "quotes", foreignKey: "book_id" }],
        search: options?.search ?? {
          children: { quotes: { self: ["quote_text"] } },
        },
      },
    });
    const quotes = sapportaTable({
      drizzle: quotesTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["quote_text"],
        references: options?.logicalReference
          ? { book_id: { table: "books" } }
          : {},
      },
    });
    return { books, quotes };
  }

  it("resolves recursive child facts once and reports missing FK indexes", () => {
    const { books, quotes } = schema();
    const catalog = createTableCatalog([books, quotes]);
    const plan = catalog.searchPlanFor("books");

    expect(plan.table).toBe(books);
    expect(plan.children[0]?.childTable).toBe(quotes);
    expect(plan.children[0]?.childForeignKey.name).toBe("book_id");
    expect(plan.children[0]?.parentTargetColumn.name).toBe("id");
    expect(catalog.searchWarnings).toEqual([
      expect.objectContaining({ table: "quotes", column: "book_id" }),
    ]);
  });

  it("supports logical references and recognizes an indexed child FK", () => {
    const { books, quotes } = schema({
      quoteIndex: true,
      logicalReference: true,
    });
    const catalog = createTableCatalog([books, quotes]);

    expect(catalog.searchPlanFor("books").children).toHaveLength(1);
    expect(catalog.searchWarnings).toEqual([]);
  });

  it("supports descendants while excluding intermediate table fields", () => {
    const booksTable = sqliteTable("books", {
      id: integer("id").primaryKey(),
      title: text("title").notNull(),
    });
    const quotesTable = sqliteTable(
      "quotes",
      {
        id: integer("id").primaryKey(),
        book_id: integer("book_id")
          .notNull()
          .references(() => booksTable.id),
        quote_text: text("quote_text").notNull(),
      },
      (table) => [index("quotes_book_id_idx").on(table.book_id)],
    );
    const annotationsTable = sqliteTable(
      "quote_annotations",
      {
        id: integer("id").primaryKey(),
        quote_id: integer("quote_id")
          .notNull()
          .references(() => quotesTable.id),
        note: text("note").notNull(),
      },
      (table) => [index("quote_annotations_quote_id_idx").on(table.quote_id)],
    );
    const books = sapportaTable({
      drizzle: booksTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["title"],
        children: [{ table: "quotes", foreignKey: "book_id" }],
        search: {
          children: {
            quotes: {
              self: false,
              children: { quote_annotations: "allColumns" },
            },
          },
        },
      },
    });
    const quotes = sapportaTable({
      drizzle: quotesTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["quote_text"],
        children: [{ table: "quote_annotations", foreignKey: "quote_id" }],
      },
    });
    const annotations = sapportaTable({
      drizzle: annotationsTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["note"],
      },
    });

    const plan = createTableCatalog([books, quotes, annotations]).searchPlanFor(
      "books",
    );
    expect(plan.children[0]?.plan.self).toEqual([]);
    expect(plan.children[0]?.plan.children[0]?.childTable).toBe(annotations);
  });

  it("allows explicitly selected hidden columns but rejects ownership fields", () => {
    const hidden = schema({ search: { self: ["internal_code"] } });
    const hiddenPlan = createTableCatalog([
      hidden.books,
      hidden.quotes,
    ]).searchPlanFor("books");
    expect(hiddenPlan.self).toEqual([
      expect.objectContaining({
        kind: "column",
        column: expect.objectContaining({ name: "internal_code" }),
      }),
    ]);

    const ownership = schema({ search: { self: ["workspace_id"] } });
    expect(() =>
      createTableCatalog([ownership.books, ownership.quotes]),
    ).toThrow(SearchPlanValidationError);
  });

  it("rejects unknown columns, unknown children, and ambiguous children", () => {
    const unknownColumn = schema({ search: { self: ["missing"] } });
    expect(() =>
      createTableCatalog([unknownColumn.books, unknownColumn.quotes]),
    ).toThrow(/does not exist/);

    const unknownChild = schema({
      search: { children: { reviews: "allColumns" } },
    });
    expect(() =>
      createTableCatalog([unknownChild.books, unknownChild.quotes]),
    ).toThrow(/not declared/);

    const ambiguous = schema();
    ambiguous.books.meta.children.push({
      table: "quotes",
      foreignKey: "book_id",
    });
    expect(() =>
      createTableCatalog([ambiguous.books, ambiguous.quotes]),
    ).toThrow(/ambiguous/);
  });

  it("rejects a child FK that targets a different parent", () => {
    const base = schema();
    const publishersTable = sqliteTable("publishers", {
      id: integer("id").primaryKey(),
      name: text("name").notNull(),
    });
    const publishers = sapportaTable({
      drizzle: publishersTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["name"],
        children: [{ table: "quotes", foreignKey: "book_id" }],
        search: { children: { quotes: "allColumns" } },
      },
    });

    expect(() =>
      createTableCatalog([base.books, base.quotes, publishers]),
    ).toThrow(/must reference "publishers.id"/);
  });

  it("retains a disabled plan for search: false", () => {
    const disabled = schema({ search: false });
    const plan = createTableCatalog([
      disabled.books,
      disabled.quotes,
    ]).searchPlanFor("books");
    expect(plan).toMatchObject({
      table: disabled.books,
      disabled: true,
      self: [],
      children: [],
    });
  });
});
