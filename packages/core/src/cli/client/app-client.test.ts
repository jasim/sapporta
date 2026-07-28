import { afterEach, describe, expect, it, vi } from "vitest";
import { SapportaCliClient, whereObjectToFilterParams } from "./app-client.js";

describe("SapportaCliClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockJsonResponse(body: unknown, status = 200): void {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(body), { status })),
      );
  }

  function lastRequestUrl(): URL {
    const [url] = vi.mocked(globalThis.fetch).mock.calls.at(-1) ?? [];
    if (!(url instanceof URL)) throw new Error("Expected fetch URL.");
    return url;
  }

  function lastRequestInit(): RequestInit {
    const [, init] = vi.mocked(globalThis.fetch).mock.calls.at(-1) ?? [];
    if (!init) throw new Error("Expected fetch init.");
    return init;
  }

  it("maps tables list --detail to the full detail query", async () => {
    mockJsonResponse({ tables: [] });

    await new SapportaCliClient({ apiUrl: "http://localhost:3000" }).listTables(
      true,
    );

    expect(lastRequestUrl().toString()).toBe(
      "http://localhost:3000/api/meta/tables?detail=full",
    );
  });

  it("maps table sample columns to the server fields parameter", async () => {
    mockJsonResponse([]);

    await new SapportaCliClient({
      apiUrl: "http://localhost:3000",
    }).sampleTable("books", { limit: 10, columns: "title,author" });

    expect(lastRequestUrl().toString()).toBe(
      "http://localhost:3000/api/meta/tables/books/sample?limit=10&fields=title%2Cauthor",
    );
  });

  it("maps row list --where to strict table filter parameters", async () => {
    mockJsonResponse({ data: [] });

    await new SapportaCliClient({ apiUrl: "http://localhost:3000" }).listRows(
      "books",
      {
        limit: 50,
        sort: "-created_at,title",
        where: { status: { eq: "active" }, id: { in: [1, 2, 3] } },
      },
    );

    const url = lastRequestUrl();
    expect(url.pathname).toBe("/api/tables/books");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("sort")).toBe("-created_at,title");
    expect(url.searchParams.get("filter[status][eq]")).toBe("active");
    expect(url.searchParams.get("filter[id][in]")).toBe("1,2,3");
  });

  it("maps row count semantics and filters to the scoped endpoint", async () => {
    mockJsonResponse({ data: [] });

    await new SapportaCliClient({
      apiUrl: "http://localhost:3000",
    }).countRows("tasks", {
      groupBy: "assignee_id",
      order: "desc",
      limit: 10,
      where: {
        status: { neq: "done" },
        assignee_id: { is: "notnull" },
      },
    });

    const url = lastRequestUrl();
    expect(url.pathname).toBe("/api/tables/tasks/_count");
    expect(url.searchParams.get("group_by")).toBe("assignee_id");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("filter[status][neq]")).toBe("done");
    expect(url.searchParams.get("filter[assignee_id][is]")).toBe("notnull");
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("rejects an empty grouped-count column instead of sending a total", async () => {
    await expect(
      new SapportaCliClient({
        apiUrl: "http://localhost:3000",
      }).countRows("tasks", { groupBy: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("maps row create and update to table POST and PUT bodies", async () => {
    mockJsonResponse({ data: { id: 1, title: "Relativity" } });
    const client = new SapportaCliClient({ apiUrl: "http://localhost:3000" });

    await client.createRows("books", { title: "Relativity" });
    expect(lastRequestUrl().pathname).toBe("/api/tables/books");
    expect(lastRequestInit()).toMatchObject({
      method: "POST",
      body: JSON.stringify({ title: "Relativity" }),
    });

    await client.updateRow("books", "1", { author: "Albert Einstein" });
    expect(lastRequestUrl().pathname).toBe("/api/tables/books/1");
    expect(lastRequestInit()).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ author: "Albert Einstein" }),
    });
  });

  it("maps SQL query and execute to explicit read/write request bodies", async () => {
    mockJsonResponse({ data: [] });
    const client = new SapportaCliClient({ apiUrl: "http://localhost:3000" });

    await client.sqlQuery("SELECT * FROM accounts WHERE type = ?", {
      params: ["asset"],
      limit: 50,
    });
    expect(lastRequestInit()).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        sql: "SELECT * FROM accounts WHERE type = ?",
        params: ["asset"],
        limit: 50,
      }),
    });

    await client.sqlExecute("UPDATE accounts SET name = ? WHERE id = ?", {
      params: ["Cash", 1],
      dryRun: true,
    });
    expect(lastRequestInit()).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        sql: "UPDATE accounts SET name = ? WHERE id = ?",
        allowDangerous: true,
        params: ["Cash", 1],
        dryRun: true,
      }),
    });
  });

  it("converts where objects without requiring bracket flags from the user", () => {
    expect(
      whereObjectToFilterParams({
        amount: { gte: 100 },
        status: { nin: ["void", "draft"] },
      }),
    ).toEqual({
      "filter[amount][gte]": "100",
      "filter[status][nin]": "void,draft",
    });
  });
});
