import { useEffect, useState } from "react";
import { useSchemaStore } from "@sapporta/frontend/schema";

// Replace this screen with the first dashboard, workflow, or form your app
// needs. The server check shows how a screen calls your typed API client.
export function Welcome() {
  const { tables, reports } = useSchemaStore();
  const [hello, setHello] = useState<HelloState>({ kind: "loading" });

  useEffect(() => {
    import("./api")
      .then(({ customApi }) => customApi.hello())
      .then(
        (body) => setHello({ kind: "ok", message: body.message }),
        (err: unknown) => {
          const apiError = readApiError(err);
          if (apiError) {
            setHello({
              kind: "error",
              status: apiError.status,
              body: apiError.body,
            });
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
            Ready to build
          </div>
          <h1 className="mt-3 text-[32px] leading-tight font-semibold tracking-sap-display text-sap-fg">
            Welcome.
          </h1>
          <p className="mt-3 text-sap-body text-sap-muted">
            This admin UI reads your project's schema live. Add a table file to{" "}
            <code className="mono text-sap-emph text-sap-fg">
              packages/api/schema/
            </code>{" "}
            and it appears in the sidebar with CRUD, validation, and a grid.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Tables discovered" value={tables.length} />
          <Stat label="Reports discovered" value={reports.length} />
        </div>

        <section>
          <div className="text-sap-label font-semibold uppercase tracking-sap-section text-sap-subtle mb-3">
            Server check
          </div>
          <HelloPanel state={hello} />
          <p className="mt-3 text-sap-data text-sap-muted">
            This screen calls{" "}
            <code className="mono text-sap-fg">customApi.hello()</code>. The
            contract is in{" "}
            <code className="mono text-sap-fg">
              packages/shared/src/contracts/hello.ts
            </code>
            ; the handler is in{" "}
            <code className="mono text-sap-fg">packages/api/app/hello.ts</code>,
            and the client is in{" "}
            <code className="mono text-sap-fg">
              packages/frontend/src/api.ts
            </code>
            {"."}
          </p>
        </section>

        <section>
          <div className="text-sap-label font-semibold uppercase tracking-sap-section text-sap-subtle mb-3">
            Add your first table
          </div>
          <pre className="mono text-sap-data bg-sap-sidebar border border-sap-border rounded-md p-4 overflow-x-auto leading-relaxed">
            {`// packages/api/schema/invoices.ts
import { table, sqliteTable, text, integer } from "@sapporta/server/table";

export const invoicesTable = sqliteTable("invoices", {
  id:       integer("id").primaryKey({ autoIncrement: true }),
  workspace_id: text("workspace_id").notNull(),
  scoped_to_user_id: text("scoped_to_user_id").notNull(),
  customer: text("customer").notNull(),
  amount:   integer("amount"),
  due:      text("due"),
});

export const invoices = table({
  drizzle: invoicesTable,
  meta: { label: "Invoices" },
});`}
          </pre>
          <p className="mt-3 text-sap-data text-sap-muted">
            Save, run{" "}
            <code className="mono text-sap-fg">
              pnpm --filter ./packages/api db:generate --name add_invoices
            </code>
            , review the SQL, and run{" "}
            <code className="mono text-sap-fg">
              pnpm --filter ./packages/api db:migrate
            </code>
            . After the server restarts, the table will be ready in the sidebar.
          </p>
        </section>

        <footer className="pt-6 border-t border-sap-border text-sap-data text-sap-subtle">
          When your own screens are in place, remove{" "}
          <code className="mono text-sap-fg">
            packages/frontend/src/Welcome.tsx
          </code>{" "}
          and update the sidebar entry and route in{" "}
          <code className="mono text-sap-fg">App.tsx</code>.
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
        Checking /api/hello…
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
        GET /api/hello failed
        {state.status ? ` with status ${state.status}` : ""}
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

function readApiError(
  value: unknown,
): { status: number; body: unknown } | null {
  if (!value || typeof value !== "object") return null;
  const status = "status" in value ? value.status : undefined;
  if (typeof status !== "number") return null;
  return { status, body: "body" in value ? value.body : undefined };
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
