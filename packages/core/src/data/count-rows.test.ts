import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { and, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createTestDb } from "../testing/test-utils.js";
import { date } from "../schema/columns.js";
import { sapportaTable } from "../schema/table.js";
import { scopedRows } from "./scoped-rows.js";

const tasksTable = sqliteTable("tasks", {
  id: integer("id").primaryKey(),
  workspace_id: text("workspace_id").notNull(),
  title: text("title").notNull(),
  assignee_id: integer("assignee_id"),
  status: text("status", {
    enum: ["backlog", "in_progress", "review", "done"],
  }).notNull(),
});

const tasks = sapportaTable({
  drizzle: tasksTable,
  meta: {
    rowScope: "workspaceGlobal",
    rowLabelColumns: ["title"],
  },
});

function setupTasks() {
  const { db, sqlite } = createTestDb();
  sqlite.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      assignee_id INTEGER,
      status TEXT NOT NULL
    );
    INSERT INTO tasks (id, workspace_id, title, assignee_id, status) VALUES
      (1, 'workspace-1', 'Maya one', 1, 'backlog'),
      (2, 'workspace-1', 'Maya two', 1, 'in_progress'),
      (3, 'workspace-1', 'Maya done', 1, 'done'),
      (4, 'workspace-1', 'Jon one', 2, 'review'),
      (5, 'workspace-1', 'Jon two', 2, 'backlog'),
      (6, 'workspace-1', 'Ana one', 3, 'backlog'),
      (7, 'workspace-1', 'Unassigned one', NULL, 'backlog'),
      (8, 'workspace-1', 'Unassigned two', NULL, 'review'),
      (20, 'workspace-2', 'Hidden one', 9, 'backlog'),
      (21, 'workspace-2', 'Hidden two', 9, 'backlog');
  `);
  return {
    rows: scopedRows(
      db,
      createTestAuthContext({ workspaceId: "workspace-1", tables: [tasks] }),
      tasks,
    ),
    sqlite,
  };
}

describe("scoped counts", () => {
  it("returns a scalar total inside row scope", async () => {
    const { rows, sqlite } = setupTasks();
    try {
      await expect(
        rows.count({
          where: ne(tasksTable.status, "done"),
        }),
      ).resolves.toBe(7);
    } finally {
      sqlite.close();
    }
  });

  it("returns bounded, deterministically ordered groups", async () => {
    const { rows, sqlite } = setupTasks();
    try {
      await expect(
        rows.countBy({
          where: and(
            ne(tasksTable.status, "done"),
            isNotNull(tasksTable.assignee_id),
          ),
          column: tasksTable.assignee_id,
          order: "desc",
          limit: 2,
        }),
      ).resolves.toEqual([
        { value: 1, count: 2 },
        { value: 2, count: 2 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("treats null as an ordinary group value", async () => {
    const { rows, sqlite } = setupTasks();
    try {
      await expect(
        rows.countBy({
          where: ne(tasksTable.status, "done"),
          column: tasksTable.assignee_id,
        }),
      ).resolves.toEqual([
        { value: null, count: 2 },
        { value: 1, count: 2 },
        { value: 2, count: 2 },
        { value: 3, count: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it("rejects invalid direct grouped-count inputs", async () => {
    const { rows, sqlite } = setupTasks();
    const otherTable = sqliteTable("other", {
      id: integer("id").primaryKey(),
    });
    try {
      await expect(
        rows.countBy({ column: tasksTable.id, limit: 0 }),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(
        rows.countBy({
          column: otherTable.id as unknown as typeof tasksTable.id,
        }),
      ).rejects.toThrow(/does not belong/);
    } finally {
      sqlite.close();
    }
  });

  it("returns temporal group values in canonical JSON form", async () => {
    const eventsTable = sqliteTable("events", {
      id: integer("id").primaryKey(),
      occurred_on: date("occurred_on").notNull(),
      title: text("title").notNull(),
    });
    const events = sapportaTable({
      drizzle: eventsTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["title"],
      },
    });
    const { db, sqlite } = createTestDb();
    sqlite.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        occurred_on TEXT NOT NULL,
        title TEXT NOT NULL
      );
      INSERT INTO events (id, occurred_on, title) VALUES
        (1, '2026-07-01', 'One'),
        (2, '2026-07-01', 'Two'),
        (3, '2026-07-02', 'Three');
    `);
    try {
      const rows = scopedRows(
        db,
        createTestAuthContext({ tables: [events] }),
        events,
      );
      await expect(
        rows.countBy({ column: eventsTable.occurred_on }),
      ).resolves.toEqual([
        { value: "2026-07-01", count: 2 },
        { value: "2026-07-02", count: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });
});

describe("count database execution", () => {
  it("aggregates in SQL without reading complete rows", async () => {
    const sqlite = new Database(":memory:");
    const queries: Array<{ query: string; params: unknown[] }> = [];
    const db = drizzle(sqlite, {
      logger: {
        logQuery(query, params) {
          queries.push({ query, params });
        },
      },
    });
    const guardedTable = sqliteTable("guarded_tasks", {
      id: integer("id").primaryKey(),
      status: text("status").notNull(),
      title: text("title").notNull(),
    });
    const guarded = sapportaTable({
      drizzle: guardedTable,
      meta: {
        rowScope: "systemGlobal",
        rowLabelColumns: ["title"],
      },
    });
    sqlite.function("fail_on_full_row_read", (_value: string) => {
      throw new Error("complete task rows must not be loaded");
    });
    sqlite.exec(`
      CREATE TABLE raw_tasks (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        title TEXT NOT NULL
      );
      CREATE VIEW guarded_tasks AS
        SELECT id, status, fail_on_full_row_read(title) AS title
        FROM raw_tasks;
      INSERT INTO raw_tasks (id, status, title) VALUES
        (1, 'smaller', 'One'),
        (2, 'winner', 'Two'),
        (3, 'winner', 'Three');
    `);
    const rows = scopedRows(
      db,
      createTestAuthContext({ tables: [guarded] }),
      guarded,
    );
    queries.length = 0;

    try {
      await expect(
        rows.countBy({
          column: guardedTable.status,
          order: "desc",
          limit: 1,
        }),
      ).resolves.toEqual([{ value: "winner", count: 2 }]);
      expect(queries).toHaveLength(1);
      expect(queries[0]?.query.toLowerCase()).toContain("count(*)");
      expect(queries[0]?.query.toLowerCase()).toContain("group by");
      expect(queries[0]?.query.toLowerCase()).not.toContain('"title"');
    } finally {
      sqlite.close();
    }
  });
});
