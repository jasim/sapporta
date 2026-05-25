import { useEffect, useState } from "react";
import { useSchemaStore } from "@sapporta/frontend";
import { ApiError } from "@sapporta/shared/client";
import { customApi } from "./api";

// Starter view wired from Sidebar.tsx and App.tsx. Delete all three entries
// (this file, the sidebar item, and the route) once your own views take over.
//
// The "Hello from server" panel below proves the typed-client roundtrip:
// `customApi.hello()` calls `/api/hello`, registered on the backend in
// `packages/api/app/hello.ts` against the same `helloContract` exported from
// `__SLUG__-shared`. Errors are shown verbatim — never reinterpreted —
// so the panel is also a smoke test for the contract wiring.
export function Welcome() {
  const { tables, reports } = useSchemaStore();
  const [hello, setHello] = useState<HelloState>({ kind: "loading" });

  useEffect(() => {
    customApi.hello().then(
      (body) => setHello({ kind: "ok", message: body.message }),
      (err: unknown) => {
        if (err instanceof ApiError) {
          setHello({ kind: "error", status: err.status, body: err.body });
        } else {
          setHello({ kind: "error", status: 0, body: err });
        }
      },
    );
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="max-w-[640px] mx-auto px-10 py-14 space-y-10">
        <header>
          <div className="text-sap-label font-semibold uppercase tracking-sap-section text-sap-subtle">
            Sapporta is running
          </div>
          <h1 className="mt-3 text-[32px] leading-tight font-semibold tracking-sap-display text-sap-fg">
            Hello.
          </h1>
          <p className="mt-3 text-sap-body text-sap-muted">
            This admin UI reads your project's schema live. Add a file to{" "}
            <code className="mono text-sap-emph text-sap-fg">packages/api/schema/</code> and
            it shows up in the sidebar with CRUD, validation, and a grid — no
            glue code.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Tables discovered" value={tables.length} />
          <Stat label="Reports discovered" value={reports.length} />
        </div>

        <section>
          <div className="text-sap-label font-semibold uppercase tracking-sap-section text-sap-subtle mb-3">
            Hello from server
          </div>
          <HelloPanel state={hello} />
          <p className="mt-3 text-sap-data text-sap-muted">
            Round trip via{" "}
            <code className="mono text-sap-fg">customApi.hello()</code> — the
            contract lives in <code className="mono text-sap-fg">packages/shared/src/contracts/hello.ts</code>,
            handler in <code className="mono text-sap-fg">packages/api/app/hello.ts</code>,
            client in <code className="mono text-sap-fg">packages/frontend/src/api.ts</code>.
          </p>
        </section>

        <section>
          <div className="text-sap-label font-semibold uppercase tracking-sap-section text-sap-subtle mb-3">
            Your first table
          </div>
          <pre className="mono text-sap-data bg-sap-sidebar border border-sap-border rounded-md p-4 overflow-x-auto leading-relaxed">
            {`// packages/api/schema/invoices.ts
import { table } from "@sapporta/server/table";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export default table({
  drizzle: sqliteTable("invoices", {
    id:       integer("id").primaryKey({ autoIncrement: true }),
    customer: text("customer").notNull(),
    amount:   integer("amount"),
    due:      text("due"),
  }),
  meta: { label: "Invoices" },
});`}
          </pre>
          <p className="mt-3 text-sap-data text-sap-muted">
            Save, run{" "}
            <code className="mono text-sap-fg">sapporta schema sync</code>, refresh
            — it'll be in the sidebar with a working grid.
          </p>
        </section>

        <footer className="pt-6 border-t border-sap-border text-sap-data text-sap-subtle">
          Delete{" "}
          <code className="mono text-sap-fg">packages/frontend/src/Welcome.tsx</code> and
          its entries in{" "}
          <code className="mono text-sap-fg">Sidebar.tsx</code> /{" "}
          <code className="mono text-sap-fg">App.tsx</code> when you're ready.
        </footer>
      </div>
    </div>
  );
}

type HelloState =
  | { kind: "loading" }
  | { kind: "ok"; message: string }
  | { kind: "error"; status: number; body: unknown };

function HelloPanel({ state }: { state: HelloState }) {
  if (state.kind === "loading") {
    return (
      <div className="border border-sap-border rounded-md px-4 py-3 bg-sap-sidebar text-sap-data text-sap-subtle">
        Calling /api/hello…
      </div>
    );
  }
  if (state.kind === "ok") {
    return (
      <div className="border border-sap-border rounded-md px-4 py-3 bg-sap-sidebar text-sap-data text-sap-fg">
        {state.message}
      </div>
    );
  }
  return (
    <div className="border border-sap-border rounded-md px-4 py-3 bg-sap-sidebar text-sap-data">
      <div className="text-sap-fg font-medium mb-1">
        GET /api/hello failed{state.status ? ` with status ${state.status}` : ""}
      </div>
      <pre className="mono text-sap-micro text-sap-muted whitespace-pre-wrap break-words">
        {formatError(state.body)}
      </pre>
    </div>
  );
}

function formatError(body: unknown): string {
  if (body instanceof Error) return body.message;
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-sap-border rounded-md px-4 py-3 bg-sap-sidebar">
      <div className="text-sap-micro uppercase tracking-sap-label text-sap-subtle font-semibold">
        {label}
      </div>
      <div className="mt-1 text-sap-display font-semibold tabular-nums text-sap-fg">
        {value}
      </div>
    </div>
  );
}
