import { QueryClient } from "@tanstack/react-query";
import type { Row } from "@sapporta/shared/contracts";
import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import {
  tableQueryKeys,
  tableRecordQueryOptions,
  tableRecordsPageQueryOptions,
} from "@sapporta/frontend/table/query";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function queryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("table query integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds hierarchical page keys from the serialized request", () => {
    const first = tableQueryKeys.page({
      tableName: "audit_events",
      page: 2,
      limit: 25,
      filters: [
        {
          id: "filter-from-first-view",
          column: "severity",
          op: "eq",
          kind: "text",
          value: "high",
        },
      ],
      search: "timeout",
    });
    const sameRequest = tableQueryKeys.page({
      tableName: "audit_events",
      page: 2,
      limit: 25,
      filters: [
        {
          id: "different-ui-only-id",
          column: "severity",
          op: "eq",
          kind: "text",
          value: "high",
        },
      ],
      search: "timeout",
    });

    expect(first).toEqual(sameRequest);
    expect(first.slice(0, -1)).toEqual(tableQueryKeys.pages("audit_events"));
    expect(first.at(-1)).toEqual({
      "filter[severity][eq]": "high",
      page: "2",
      limit: "25",
      q: "timeout",
    });
    expect(tableQueryKeys.record("audit_events", "event-key-42")).toEqual([
      ...tableQueryKeys.records("audit_events"),
      "event-key-42",
    ]);
  });

  it("sends repeated filters as repeated wire keys through the typed client", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [],
        meta: { total: 0, page: 1, limit: 20, pages: 0 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = queryClient();
    await client.fetchQuery(
      tableRecordsPageQueryOptions({
        tableName: "audit_events",
        page: 1,
        limit: 20,
        filters: [
          {
            id: "left",
            column: "message",
            op: "contains",
            kind: "text",
            value: "left",
          },
          {
            id: "right",
            column: "message",
            op: "contains",
            kind: "text",
            value: "right",
          },
        ],
      }),
    );

    const requestUrl = new URL(
      String(fetchMock.mock.calls[0]?.[0]),
      "http://localhost",
    );
    expect(requestUrl.searchParams.getAll("filter[message][contains]")).toEqual(
      ["left", "right"],
    );
    expect(requestUrl.searchParams.get("page")).toBe("1");
    expect(requestUrl.searchParams.get("limit")).toBe("20");
    expect(requestUrl.searchParams.has("filter[message][contains][0]")).toBe(
      false,
    );
  });

  it("decodes domain rows without a framework table registry", async () => {
    type AuditEvent = {
      key: string;
      severity: "high" | "low";
    };

    const decodeAuditEvent = (row: Row): AuditEvent => {
      if (
        typeof row.key !== "string" ||
        (row.severity !== "high" && row.severity !== "low")
      ) {
        throw new Error("Invalid audit event");
      }
      return { key: row.key, severity: row.severity };
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: { key: "event-key-42", severity: "high" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { key: "event-key-42", severity: "high" },
            { key: "event-key-43", severity: "low" },
          ],
          meta: { total: 2, page: 1, limit: 20, pages: 1 },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = queryClient();
    const record = await client.fetchQuery(
      tableRecordQueryOptions({
        tableName: "audit_events",
        recordId: "event-key-42",
        decodeRow: decodeAuditEvent,
      }),
    );
    const page = await client.fetchQuery(
      tableRecordsPageQueryOptions({
        tableName: "audit_events",
        page: 1,
        limit: 20,
        decodeRow: decodeAuditEvent,
      }),
    );

    expectTypeOf(record).toEqualTypeOf<AuditEvent>();
    expectTypeOf(page.data).toEqualTypeOf<AuditEvent[]>();
    expect(record).toEqual({ key: "event-key-42", severity: "high" });
    expect(page).toEqual({
      data: [
        { key: "event-key-42", severity: "high" },
        { key: "event-key-43", severity: "low" },
      ],
      meta: { total: 2, page: 1, limit: 20, pages: 1 },
    });
  });

  it("passes TanStack Query cancellation to the generated fetch client", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Expected a request signal");
      requestSignal = signal;

      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = queryClient();
    const options = tableRecordsPageQueryOptions({
      tableName: "audit_events",
      page: 1,
      limit: 20,
    });
    const pending = client.fetchQuery(options);

    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await client.cancelQueries({ queryKey: options.queryKey });

    expect(requestSignal?.aborted).toBe(true);
    await expect(pending).rejects.toBeDefined();
  });

  if (false) {
    // @ts-expect-error Domain row types require a decoder.
    tableRecordQueryOptions<{ key: string }>({
      tableName: "audit_events",
      recordId: "event-key-42",
    });

    // @ts-expect-error Domain page row types require a decoder.
    tableRecordsPageQueryOptions<{ key: string }>({
      tableName: "audit_events",
      page: 1,
    });
  }
});
