import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createTableCatalog } from "../schema/catalog.js";
import { table } from "../schema/table.js";
import { createTestDb } from "../testing/test-utils.js";
import {
  AuthPayloadPolicyError,
  createAuthContext,
  createRowSecurity,
  lookupRowAccessPredicate,
  requestDataAuthority,
  systemRows as systemRowsPredicate,
  systemGlobalOnlyAuthority,
  validateForeignKeyReferences,
  workspaceGlobalOnlyAuthority,
  workspaceRows as workspaceRowsPredicate,
  workspaceUserScopedAuthority,
  workspaceUserRows as workspaceUserRowsPredicate,
  type RequestDataAuthority,
  type SapportaAuthContext,
  type SapportaAbility,
} from "./index.js";

const testUser = {
  id: "user-1",
  name: "User One",
  email: "u1@example.com",
  emailVerified: true,
};

const testWorkspace = {
  id: "workspace-1",
  name: "Workspace One",
  slug: "workspace-one",
};

function auth(
  dataAuthority: RequestDataAuthority = personalRowsScope(),
): SapportaAuthContext {
  return createAuthContext({
    principal: {
      kind: "user",
      user: testUser,
      membership: { id: "member-1", roles: ["member"] },
    },
    dataAuthority,
    ability: allowAllAbility(),
    catalog: createTableCatalog([]),
  });
}

function personalRowsScope(): RequestDataAuthority {
  return requestDataAuthority({
    systemGlobalOnly: systemGlobalOnlyAuthority(),
    workspaceGlobalOnly: workspaceGlobalOnlyAuthority(testWorkspace),
    workspaceUserScoped: workspaceUserScopedAuthority({
      workspace: testWorkspace,
      user: testUser,
    }),
  });
}

function workspaceRowsScope(): RequestDataAuthority {
  return requestDataAuthority({
    systemGlobalOnly: systemGlobalOnlyAuthority(),
    workspaceGlobalOnly: workspaceGlobalOnlyAuthority(testWorkspace),
  });
}

function allowAllAbility(): SapportaAbility {
  return { can: () => true };
}

const userRowsTable = sqliteTable("user_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  label: text("label").notNull(),
});

const workspaceRowsTable = sqliteTable("workspace_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  label: text("label").notNull(),
});

const systemRowsTable = sqliteTable("system_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
});

const userRows = table({
  drizzle: userRowsTable,
  meta: { rowScope: "workspaceUserScoped" },
});
const workspaceRows = table({
  drizzle: workspaceRowsTable,
  meta: { rowScope: "workspaceGlobal" },
});
const systemRows = table({
  drizzle: systemRowsTable,
  meta: { rowScope: "systemGlobal" },
});

describe("row access predicates", () => {
  const handles: Array<ReturnType<typeof createTestDb>> = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) {
      handle.sqlite.close();
    }
  });

  function dbWithRows() {
    const handle = createTestDb();
    handles.push(handle);
    handle.sqlite.exec(`
      create table user_rows (
        id integer primary key autoincrement,
        workspace_id text not null,
        scoped_to_user_id text not null,
        label text not null
      );
      create table workspace_rows (
        id integer primary key autoincrement,
        workspace_id text not null,
        label text not null
      );
      create table system_rows (
        id integer primary key autoincrement,
        label text not null
      );
      insert into user_rows (workspace_id, scoped_to_user_id, label) values
        ('workspace-1', 'user-1', 'mine'),
        ('workspace-1', 'user-2', 'same workspace'),
        ('workspace-2', 'user-1', 'other workspace');
      insert into workspace_rows (workspace_id, label) values
        ('workspace-1', 'visible'),
        ('workspace-2', 'other workspace');
      insert into system_rows (label) values ('country'), ('currency');
    `);
    return handle;
  }

  it("workspace-user predicates include workspace and scoped user", async () => {
    const { db } = dbWithRows();

    const rows = await db
      .select()
      .from(userRows.drizzle)
      .where(workspaceUserRowsPredicate(auth().dataAuthority, userRows));

    expect(rows.map((row) => row.label)).toEqual(["mine"]);
  });

  it("workspace predicates include workspace only", async () => {
    const { db } = dbWithRows();

    const rows = await db
      .select()
      .from(workspaceRows.drizzle)
      .where(workspaceRowsPredicate(auth().dataAuthority, workspaceRows));

    expect(rows.map((row) => row.label)).toEqual(["visible"]);
  });

  it("system predicates only work on systemGlobal tables", async () => {
    const { db } = dbWithRows();

    const rows = await db
      .select()
      .from(systemRows.drizzle)
      .where(systemRowsPredicate(auth().dataAuthority, systemRows));

    expect(rows).toHaveLength(2);
    expect(() => systemRowsPredicate(auth().dataAuthority, workspaceRows)).toThrow(
      /Expected systemGlobal/,
    );
  });

  it("invalid helper/table combinations fail closed", () => {
    expect(() => workspaceUserRowsPredicate(auth().dataAuthority, workspaceRows)).toThrow(
      /Expected workspaceUserScoped/,
    );
    expect(() => workspaceRowsPredicate(auth().dataAuthority, systemRows)).toThrow(
      /Expected workspaceGlobal/,
    );
    expect(() => workspaceUserRowsPredicate(workspaceRowsScope(), userRows)).toThrow(
      /workspaceGlobalOnly/,
    );
  });

  it("lookup predicate selection uses target table row scope", async () => {
    const { db } = dbWithRows();

    const normalRows = await db
      .select()
      .from(userRows.drizzle)
      .where(lookupRowAccessPredicate(auth().dataAuthority, userRows));
    const workspaceScopedRows = await db
      .select()
      .from(workspaceRows.drizzle)
      .where(lookupRowAccessPredicate(workspaceRowsScope(), workspaceRows));

    expect(normalRows.map((row) => row.label)).toEqual(["mine"]);
    expect(workspaceScopedRows.map((row) => row.label)).toEqual(["visible"]);
  });
});

describe("foreign-key auth validation", () => {
  const handles: Array<ReturnType<typeof createTestDb>> = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) {
      handle.sqlite.close();
    }
  });

  function dbWithReferenceRows() {
    const handle = createTestDb();
    handles.push(handle);
    handle.sqlite.exec(`
      create table customers (
        id text primary key,
        workspace_id text not null,
        name text not null
      );
      create table private_docs (
        id text primary key,
        workspace_id text not null,
        scoped_to_user_id text not null,
        title text not null
      );
      create table countries (
        id text primary key,
        name text not null
      );
      create table orders (
        id integer primary key autoincrement,
        workspace_id text not null,
        scoped_to_user_id text not null,
        customer_id text,
        doc_id text,
        country_id text
      );
      insert into customers (id, workspace_id, name) values
        ('customer-1', 'workspace-1', 'Visible Customer'),
        ('customer-2', 'workspace-2', 'Other Workspace Customer');
      insert into private_docs (id, workspace_id, scoped_to_user_id, title) values
        ('doc-1', 'workspace-1', 'user-1', 'Mine'),
        ('doc-2', 'workspace-1', 'user-2', 'Theirs');
      insert into countries (id, name) values ('US', 'United States');
    `);
    return handle;
  }

  const customers = table({
    drizzle: sqliteTable("customers", {
      id: text("id").primaryKey(),
      workspace_id: text("workspace_id").notNull(),
      name: text("name").notNull(),
    }),
    meta: { rowScope: "workspaceGlobal" },
  });
  const privateDocs = table({
    drizzle: sqliteTable("private_docs", {
      id: text("id").primaryKey(),
      workspace_id: text("workspace_id").notNull(),
      scoped_to_user_id: text("scoped_to_user_id").notNull(),
      title: text("title").notNull(),
    }),
    meta: { rowScope: "workspaceUserScoped" },
  });
  const countries = table({
    drizzle: sqliteTable("countries", {
      id: text("id").primaryKey(),
      name: text("name").notNull(),
    }),
    meta: { rowScope: "systemGlobal" },
  });

  it("rejects cross-workspace FK values", async () => {
    const orders = table({
      drizzle: sqliteTable("orders", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        scoped_to_user_id: text("scoped_to_user_id").notNull(),
        customer_id: text("customer_id"),
      }),
      meta: {
        rowScope: "workspaceUserScoped",
        references: { customer_id: { table: "customers" } },
      },
    });
    const { db } = dbWithReferenceRows();

    await expect(
      validateForeignKeyReferences(
        db,
        auth().dataAuthority,
        orders,
        { customer_id: "customer-2" },
        [customers, orders],
      ),
    ).rejects.toThrow(AuthPayloadPolicyError);
  });

  it("rejects current-user-invisible FK values", async () => {
    const orders = table({
      drizzle: sqliteTable("orders", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        scoped_to_user_id: text("scoped_to_user_id").notNull(),
        doc_id: text("doc_id"),
      }),
      meta: {
        rowScope: "workspaceUserScoped",
        references: { doc_id: { table: "private_docs" } },
      },
    });
    const { db } = dbWithReferenceRows();

    await expect(
      validateForeignKeyReferences(db, auth().dataAuthority, orders, { doc_id: "doc-2" }, [
        privateDocs,
        orders,
      ]),
    ).rejects.toThrow(AuthPayloadPolicyError);
  });

  it("passes valid workspace and system-global FK values", async () => {
    const orders = table({
      drizzle: sqliteTable("orders", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        scoped_to_user_id: text("scoped_to_user_id").notNull(),
        customer_id: text("customer_id"),
        country_id: text("country_id"),
      }),
      meta: {
        rowScope: "workspaceUserScoped",
        references: {
          customer_id: { table: "customers" },
          country_id: { table: "countries" },
        },
      },
    });
    const { db } = dbWithReferenceRows();

    await expect(
      validateForeignKeyReferences(
        db,
        auth().dataAuthority,
        orders,
        { customer_id: "customer-1", country_id: "US" },
        [customers, countries, orders],
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects clientCanSet false before validating target rows", async () => {
    const orders = table({
      drizzle: sqliteTable("orders", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        scoped_to_user_id: text("scoped_to_user_id").notNull(),
        country_id: text("country_id"),
      }),
      meta: {
        rowScope: "workspaceUserScoped",
        references: { country_id: { table: "countries", clientCanSet: false } },
      },
    });
    const { db } = dbWithReferenceRows();

    await expect(
      validateForeignKeyReferences(db, auth().dataAuthority, orders, { country_id: "US" }, [
        countries,
        orders,
      ]),
    ).rejects.toMatchObject({
      errors: [{ field: "country_id" }],
    });
  });
});

describe("row-security guards", () => {
  const handles: Array<ReturnType<typeof createTestDb>> = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) {
      handle.sqlite.close();
    }
  });

  function dbWithRows() {
    const handle = createTestDb();
    handles.push(handle);
    handle.sqlite.exec(`
      create table user_rows (
        id integer primary key autoincrement,
        workspace_id text not null,
        scoped_to_user_id text not null,
        label text not null
      );
      insert into user_rows (workspace_id, scoped_to_user_id, label) values
        ('workspace-1', 'user-1', 'mine'),
        ('workspace-1', 'user-2', 'same workspace');
    `);
    return handle;
  }

  function dbWithReferenceRows() {
    const handle = createTestDb();
    handles.push(handle);
    handle.sqlite.exec(`
      create table countries (
        id text primary key,
        name text not null
      );
      create table invoices (
        id text primary key,
        workspace_id text not null,
        scoped_to_user_id text not null,
        label text not null
      );
      create table orders (
        id integer primary key autoincrement,
        workspace_id text not null,
        scoped_to_user_id text not null,
        country_id text
      );
      insert into countries (id, name) values ('US', 'United States');
      insert into invoices (id, workspace_id, scoped_to_user_id, label) values
        ('invoice-1', 'workspace-1', 'user-1', 'visible'),
        ('invoice-2', 'workspace-2', 'user-1', 'other workspace'),
        ('invoice-3', 'workspace-1', 'user-2', 'other user');
    `);
    return handle;
  }

  const countries = table({
    drizzle: sqliteTable("countries", {
      id: text("id").primaryKey(),
      name: text("name").notNull(),
    }),
    meta: { rowScope: "systemGlobal" },
  });

  const invoices = table({
    drizzle: sqliteTable("invoices", {
      id: text("id").primaryKey(),
      workspace_id: text("workspace_id").notNull(),
      scoped_to_user_id: text("scoped_to_user_id").notNull(),
      label: text("label").notNull(),
    }),
    meta: { rowScope: "workspaceUserScoped" },
  });

  it("adds trusted ownership fields and rejects client ownership fields", () => {
    const guard = auth().rowSecurity.forTable(userRows);

    expect(guard.addOwnershipFields({ label: "New" })).toEqual({
      label: "New",
      workspace_id: "workspace-1",
      scoped_to_user_id: "user-1",
    });
    expect(() =>
      guard.ensureOwnership({ label: "Bad", workspace_id: "workspace-2" }),
    ).toThrow(AuthPayloadPolicyError);
  });

  it("prepares insert values by rejecting client ownership and stamping trusted ownership", async () => {
    const { db } = dbWithRows();
    const guard = createRowSecurity(auth().dataAuthority, {
      catalog: createTableCatalog([userRows]),
    }).forTable(userRows);

    await expect(
      guard.insertValues(db, { label: "Bad", workspace_id: "workspace-2" }),
    ).rejects.toThrow(AuthPayloadPolicyError);

    await expect(guard.insertValues(db, { label: "New" })).resolves.toEqual({
      label: "New",
      workspace_id: "workspace-1",
      scoped_to_user_id: "user-1",
    });
  });

  it("prepares patch values without stamping ownership", async () => {
    const { db } = dbWithRows();
    const guard = createRowSecurity(auth().dataAuthority, {
      catalog: createTableCatalog([userRows]),
    }).forTable(userRows);

    await expect(
      guard.patchValues(db, { label: "Bad", scoped_to_user_id: "user-2" }),
    ).rejects.toThrow(AuthPayloadPolicyError);
    await expect(guard.patchValues(db, { label: "Updated" })).resolves.toEqual({
      label: "Updated",
    });
  });

  it("prepares many insert values and rejects empty batches", async () => {
    const { db } = dbWithRows();
    const guard = createRowSecurity(auth().dataAuthority, {
      catalog: createTableCatalog([userRows]),
    }).forTable(userRows);

    await expect(guard.insertManyValues(db, [])).rejects.toMatchObject({
      errors: [{ field: "$" }],
    });

    await expect(
      guard.insertManyValues(db, [{ label: "A" }, { label: "B" }]),
    ).resolves.toEqual([
      { label: "A", workspace_id: "workspace-1", scoped_to_user_id: "user-1" },
      { label: "B", workspace_id: "workspace-1", scoped_to_user_id: "user-1" },
    ]);
  });

  it("composes owned row predicates with caller predicates", async () => {
    const { db } = dbWithRows();
    const guard = auth().rowSecurity.forTable(userRows);

    const rows = await db
      .select()
      .from(userRows.drizzle)
      .where(guard.ownedRows(eq(userRowsTable.label, "mine")));

    expect(rows.map((row) => row.label)).toEqual(["mine"]);
  });

  it("rejects client-submitted non-client-settable references", async () => {
    const orders = table({
      drizzle: sqliteTable("orders", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        scoped_to_user_id: text("scoped_to_user_id").notNull(),
        country_id: text("country_id"),
      }),
      meta: {
        rowScope: "workspaceUserScoped",
        references: { country_id: { table: "countries", clientCanSet: false } },
      },
    });
    const { db } = dbWithReferenceRows();
    const guard = createRowSecurity(auth().dataAuthority, {
      catalog: createTableCatalog([countries, orders]),
    }).forTable(orders);

    await expect(
      guard.insertValues(db, { country_id: "US" }),
    ).rejects.toMatchObject({
      errors: [{ field: "country_id" }],
    });
  });

  it("allows server-authored references and still validates final visibility", async () => {
    const lines = table({
      drizzle: sqliteTable("lines", {
        id: integer("id").primaryKey({ autoIncrement: true }),
        workspace_id: text("workspace_id").notNull(),
        scoped_to_user_id: text("scoped_to_user_id").notNull(),
        invoice_id: text("invoice_id"),
      }),
      meta: {
        rowScope: "workspaceUserScoped",
        references: { invoice_id: { table: "invoices", clientCanSet: false } },
      },
    });
    const { db } = dbWithReferenceRows();
    const guard = createRowSecurity(auth().dataAuthority, {
      catalog: createTableCatalog([invoices, lines]),
    }).forTable(lines);

    await expect(
      guard.insertValues(db, {}, { serverValues: { invoice_id: "invoice-1" } }),
    ).resolves.toEqual({
      invoice_id: "invoice-1",
      workspace_id: "workspace-1",
      scoped_to_user_id: "user-1",
    });

    await expect(
      guard.insertValues(db, {}, { serverValues: { invoice_id: "invoice-2" } }),
    ).rejects.toMatchObject({
      errors: [{ field: "invoice_id" }],
    });

    await expect(
      guard.insertValues(db, {}, { serverValues: { invoice_id: "invoice-3" } }),
    ).rejects.toMatchObject({
      errors: [{ field: "invoice_id" }],
    });
  });
});
