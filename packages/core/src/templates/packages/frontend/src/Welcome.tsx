import { useEffect, useState } from "react";
import {
  fetchAuthContext,
  useAuthStore,
} from "@sapporta/frontend/auth/runtime";
import { getApiBase } from "@sapporta/frontend/platform";
import { useSchemaStore } from "@sapporta/frontend/schema";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  SearchCheck,
  Stethoscope,
} from "lucide-react";

const sapportaDocsUrl = "https://github.com/jasim/sapporta/tree/main/docs";

const projectReferences = `Read these before implementation:
- [README.md](README.md)
- [AGENTS.md](AGENTS.md)
- [Sapporta coding-agent skill](https://github.com/jasim/sapporta-skills/tree/main/skills/sapporta)`;

const appIdeas = [
  {
    id: "bookkeeping",
    label: "Double-entry books",
    eyebrow: "Accounting",
    description: "Accounts, journals, ledgers, trial balance, and statements.",
    prompt: `Build a double-entry bookkeeping application.

The application should manage accounts, journals, journal entries, customers, vendors, invoices, invoice line items, payments, and tax categories. Users should be able to move from an account to its ledger entries and from an invoice to its line items and payments.

Include workflows for posting journal entries and creating invoices with line items. Include reports for trial balance, account ledger, monthly income and expenses, accounts receivable aging, and customer balances. Populate the application with realistic sample accounting data so the first run shows working ledgers, invoices, payments, and reports.`,
  },
  {
    id: "invoices",
    label: "Invoice operations",
    eyebrow: "Business",
    description: "Customers, quotes, invoices, payments, and receivables.",
    prompt: `Build an invoice operations application.

The application should manage customers, contacts, products or services, quotes, quote line items, invoices, invoice line items, payments, and payment allocations. Invoice totals should come from line items, and invoice status should move from draft to sent to paid.

Include a workflow where a user can enter an invoice and its line items together. Include reports for monthly revenue, unpaid invoices, overdue receivables, customer payment history, and product or service sales. Populate the application with realistic sample customers, products or services, invoices, payments, and receivables activity so the first run feels complete.`,
  },
  {
    id: "inventory",
    label: "Inventory control",
    eyebrow: "Operations",
    description:
      "Items, suppliers, stock moves, reorder points, and purchase orders.",
    prompt: `Build an inventory control application.

The application should manage items, item categories, suppliers, warehouses or locations, stock movements, purchase orders, purchase order lines, receiving records, and reorder rules. Users should be able to open an item and review its movements, suppliers, purchase history, and current location balances.

Include workflows for recording stock receipts, adjustments, transfers, and purchase orders with lines. Include reports for current stock on hand, low-stock items, inventory valuation, supplier purchase history, and movement activity by month. Populate the application with realistic sample items, suppliers, purchase orders, stock movements, and inventory balances so the first run demonstrates the workflow.`,
  },
  {
    id: "meals",
    label: "Meal tracking",
    eyebrow: "Personal data",
    description: "Foods, meals, calories, macros, and daily nutrition totals.",
    prompt: `Build a meal and nutrition tracking application.

The application should manage foods, serving units, meals, meal items, daily targets, body measurements, and nutrition goals. Track calories, protein, carbs, fat, fiber, and serving sizes. Users should be able to move from a day to its meals and from a food to its usage history.

Include workflows for logging a meal with multiple foods and copying a previous meal into today. Include reports for daily nutrition totals, weekly averages, macro balance, calorie trend, and foods eaten most often. Populate the application with realistic sample foods, meals, targets, and nutrition logs so the first run shows meaningful daily and weekly totals.`,
  },
  {
    id: "membership",
    label: "Membership CRM",
    eyebrow: "Business",
    description: "Members, households, dues, renewals, events, and attendance.",
    prompt: `Build a membership CRM.

The application should manage members, households or organizations, memberships, dues schedules, payments, events, event registrations, attendance, notes, and tags. Model renewals and membership status clearly, with relationships from members to payments, events, and notes.

Include workflows for registering a new member, recording dues payments, renewing memberships, and taking event attendance. Include reports for active members, renewal pipeline, overdue dues, event attendance, and monthly membership income. Populate the application with realistic sample members, households, dues, payments, events, and attendance records so the first run shows an active organization.`,
  },
  {
    id: "assets",
    label: "Asset maintenance",
    eyebrow: "Personal or business",
    description: "Equipment, service logs, schedules, costs, and reminders.",
    prompt: `Build an asset maintenance application.

The application should manage assets, asset categories, locations, vendors, maintenance tasks, service logs, parts, part usage, warranties, and recurring schedules. Users should be able to open an asset and see its service history, upcoming work, vendors, parts, and total cost.

Include workflows for recording a completed service visit and scheduling future maintenance. Include reports for upcoming maintenance, overdue tasks, maintenance cost by asset, vendor spend, and service history by month. Populate the application with realistic sample assets, vendors, service logs, parts, and schedules so the first run shows current and historical maintenance activity.`,
  },
] as const;

type AppIdea = (typeof appIdeas)[number];

// Replace this screen with the first dashboard, workflow, or form your app
// needs after the app has its own primary surface.
export function Welcome() {
  const { tables, loaded, error, name, slug } = useSchemaStore();
  const authStatus = useAuthStore((s) => s.status);
  const authContext = useAuthStore((s) => s.context);
  const authError = useAuthStore((s) => s.error);
  const [selectedIdeaId, setSelectedIdeaId] =
    useState<AppIdea["id"]>("bookkeeping");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [viewMode, setViewMode] = useState<ViewMode>("onboarding");
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult[]>([]);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);

  const selectedIdea =
    appIdeas.find((idea) => idea.id === selectedIdeaId) ?? appIdeas[0];
  const activePrompt = `${selectedIdea.prompt}

${projectReferences}`;

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  async function copyAgentPrompt() {
    try {
      await navigator.clipboard.writeText(activePrompt);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  async function openDiagnostics() {
    setViewMode("diagnostics");
    await runDiagnostics();
  }

  async function runDiagnostics() {
    setDiagnosticsRunning(true);
    setDiagnostics([
      renderCheckResult("frontend", "pass", "Frontend route rendered."),
      schemaCheck({ loaded, error, tables, name, slug }),
      authStoreCheck({ authStatus, authContext, authError }),
    ]);

    const results = await Promise.all([
      checkHelloRoute(),
      checkAuthContextRoute(),
    ]);

    setDiagnostics((current) => [...current, ...results]);
    setDiagnosticsRunning(false);
  }

  return (
    <div className="flex-1 overflow-y-auto bg-sap-surface">
      <div className="mx-auto max-w-[980px] px-5 py-8 sm:px-8 lg:px-10">
        {viewMode === "diagnostics" ? (
          <>
            <header className="border-b border-sap-border pb-7">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-[720px]">
                  <div className="text-sap-label font-semibold uppercase tracking-sap-section text-sap-brand">
                    Project diagnostics
                  </div>
                  <h1 className="mt-3 text-[34px] font-semibold leading-tight tracking-sap-display text-sap-fg sm:text-[40px]">
                    Check the frontend, API, schema, and auth connection.
                  </h1>
                  <p className="mt-4 max-w-[680px] text-sap-body leading-7 text-sap-soft">
                    These checks help identify the common failure points when
                    the frontend has rendered but cannot load metadata, call the
                    API, or refresh the authenticated workspace context.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    className="inline-flex h-9 items-center justify-center rounded-[7px] border border-sap-border bg-sap-panel px-3 text-sap-data font-medium text-sap-fg hover:bg-sap-row-hover"
                    type="button"
                    onClick={() => setViewMode("onboarding")}
                  >
                    Onboarding
                  </button>
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-[7px] border border-sap-border bg-sap-panel px-3 text-sap-data font-medium text-sap-fg hover:bg-sap-row-hover disabled:opacity-70"
                    type="button"
                    onClick={runDiagnostics}
                    disabled={diagnosticsRunning}
                  >
                    <SearchCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {diagnosticsRunning ? "Running" : "Run again"}
                  </button>
                </div>
              </div>
            </header>

            <section className="py-7">
              <div className="grid gap-2">
                {diagnostics.map((result) => (
                  <DiagnosticRow key={result.id} result={result} />
                ))}
              </div>
            </section>
          </>
        ) : (
          <>
            <header className="border-b border-sap-border pb-7">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-[720px]">
                  <div className="text-sap-label font-semibold uppercase tracking-sap-section text-sap-brand">
                    Welcome
                  </div>
                  <h1 className="mt-3 text-[34px] font-semibold leading-tight tracking-sap-display text-sap-fg sm:text-[40px]">
                    Use a coding agent to extend this Sapporta project.
                  </h1>
                  <p className="mt-4 max-w-[680px] text-sap-body leading-7 text-sap-soft">
                    Select an application pattern to generate a starting prompt.
                    The prompt describes the target data model, workflows, and
                    reports, then points the agent to the project documentation
                    and Sapporta skill for implementation details.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <a
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-[7px] border border-sap-border bg-sap-panel px-3 text-sap-data font-medium text-sap-fg hover:bg-sap-row-hover"
                    href={sapportaDocsUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Docs
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </a>
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-[7px] border border-sap-border bg-sap-panel px-3 text-sap-data font-medium text-sap-fg hover:bg-sap-row-hover"
                    type="button"
                    onClick={openDiagnostics}
                  >
                    <Stethoscope className="h-3.5 w-3.5" strokeWidth={1.8} />
                    Diagnostics
                  </button>
                </div>
              </div>
            </header>

            <main className="grid gap-8 py-8 lg:grid-cols-[320px_minmax(0,1fr)]">
              <section>
                <div className="mb-3 text-sap-label font-semibold uppercase tracking-sap-section text-sap-brand">
                  Choose a prompt
                </div>
                <div className="grid gap-2">
                  {appIdeas.map((idea) => (
                    <button
                      className={[
                        "w-full rounded-md border px-4 py-3 text-left transition-colors",
                        selectedIdea.id === idea.id
                          ? "border-sap-brand bg-sap-active-nav text-sap-fg"
                          : "border-sap-border bg-sap-panel text-sap-fg hover:bg-sap-row-hover",
                      ].join(" ")}
                      key={idea.id}
                      type="button"
                      onClick={() => setSelectedIdeaId(idea.id)}
                    >
                      <div className="text-sap-micro font-semibold uppercase tracking-sap-label text-sap-muted">
                        {idea.eyebrow}
                      </div>
                      <div className="mt-1 text-sap-body font-semibold">
                        {idea.label}
                      </div>
                      <div className="mt-1 text-sap-data leading-5 text-sap-soft">
                        {idea.description}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="min-w-0">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sap-label font-semibold uppercase tracking-sap-section text-sap-brand">
                      Agent prompt
                    </div>
                    <h2 className="mt-1 text-[22px] font-semibold leading-tight text-sap-fg">
                      {selectedIdea.label}
                    </h2>
                  </div>
                  <button
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-[7px] bg-sap-brand px-3 text-sap-data font-semibold text-sap-bg hover:opacity-90"
                    type="button"
                    onClick={copyAgentPrompt}
                  >
                    {copyStatus === "copied" ? (
                      <Check className="h-4 w-4" strokeWidth={2} />
                    ) : (
                      <Copy className="h-4 w-4" strokeWidth={1.9} />
                    )}
                    {copyStatus === "copied"
                      ? "Copied"
                      : copyStatus === "error"
                        ? "Copy failed"
                        : "Copy prompt"}
                  </button>
                </div>

                <div className="overflow-hidden rounded-md border border-sap-border bg-sap-panel">
                  <pre className="mono max-h-[520px] overflow-auto whitespace-pre-wrap p-5 text-[13px] leading-6 text-sap-fg">
                    {activePrompt}
                  </pre>
                </div>
              </section>
            </main>
          </>
        )}
      </div>
    </div>
  );
}

type ViewMode = "onboarding" | "diagnostics";

type CopyStatus = "idle" | "copied" | "error";

type DiagnosticStatus = "pass" | "warn" | "fail";

interface DiagnosticResult {
  id: string;
  label: string;
  status: DiagnosticStatus;
  message: string;
  detail?: string;
}

function DiagnosticRow({ result }: { result: DiagnosticResult }) {
  const statusClass =
    result.status === "pass"
      ? "text-sap-positive"
      : result.status === "warn"
        ? "text-sap-brand"
        : "text-sap-negative";

  return (
    <div className="grid gap-3 rounded-md border border-sap-border bg-sap-panel px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
      <div
        className={`flex items-center gap-2 text-sap-data font-semibold ${statusClass}`}
      >
        {result.status === "pass" ? (
          <Check className="h-4 w-4" strokeWidth={2} />
        ) : (
          <AlertTriangle className="h-4 w-4" strokeWidth={1.9} />
        )}
        {statusLabel(result.status)}
      </div>
      <div className="min-w-0">
        <div className="text-sap-body font-semibold text-sap-fg">
          {result.label}
        </div>
        <p className="mt-1 text-sap-data leading-5 text-sap-soft">
          {result.message}
        </p>
        {result.detail ? (
          <pre className="mono mt-2 whitespace-pre-wrap break-words rounded-md border border-sap-border bg-sap-sidebar p-3 text-sap-micro leading-5 text-sap-fg">
            {result.detail}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function statusLabel(status: DiagnosticStatus): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "warn":
      return "Check";
    case "fail":
      return "Fail";
  }
}

function renderCheckResult(
  id: string,
  status: DiagnosticStatus,
  message: string,
  detail?: string,
): DiagnosticResult {
  return {
    id,
    label: diagnosticLabels[id] ?? id,
    status,
    message,
    detail,
  };
}

const diagnosticLabels: Record<string, string> = {
  frontend: "Frontend route",
  schema: "Schema metadata",
  authStore: "Auth gate state",
  helloRoute: "Custom API route",
  authRoute: "Auth context route",
};

function schemaCheck(args: {
  loaded: boolean;
  error: string | null;
  tables: unknown[];
  name: string | null;
  slug: string | null;
}): DiagnosticResult {
  if (args.error) {
    return renderCheckResult(
      "schema",
      "fail",
      "The app shell rendered, but schema metadata has an error.",
      args.error,
    );
  }
  if (!args.loaded) {
    return renderCheckResult(
      "schema",
      "warn",
      "Schema metadata is not marked as loaded yet. The boot loader may still be waiting on /api/meta/tables.",
    );
  }
  return renderCheckResult(
    "schema",
    "pass",
    `Loaded ${args.tables.length} table schema${args.tables.length === 1 ? "" : "s"}.`,
    `Project: ${args.name ?? "unknown"}\nSlug: ${args.slug ?? "unknown"}\nAPI base: ${getApiBase()}`,
  );
}

function authStoreCheck(args: {
  authStatus: string;
  authContext: unknown;
  authError: string | null;
}): DiagnosticResult {
  if (args.authStatus === "authenticated" && args.authContext) {
    return renderCheckResult(
      "authStore",
      "pass",
      "The protected app shell has an authenticated user and workspace context.",
    );
  }
  if (args.authStatus === "error") {
    return renderCheckResult(
      "authStore",
      "fail",
      "The auth store is in an error state.",
      args.authError ?? undefined,
    );
  }
  return renderCheckResult(
    "authStore",
    "warn",
    `The auth store status is "${args.authStatus}". If this page is visible unexpectedly, inspect /api/auth-context and the auth gate.`,
  );
}

async function checkHelloRoute(): Promise<DiagnosticResult> {
  try {
    const { customApi } = await import("./api");
    const body = await customApi.hello();
    return renderCheckResult(
      "helloRoute",
      "pass",
      "The frontend can call the sample custom API route.",
      formatJson(body),
    );
  } catch (err) {
    const apiError = readApiError(err);
    if (apiError) {
      return renderCheckResult(
        "helloRoute",
        "fail",
        `GET /api/hello returned status ${apiError.status}.`,
        formatError(apiError.body),
      );
    }
    return renderCheckResult(
      "helloRoute",
      "fail",
      "The sample custom API route could not be reached.",
      formatError(err),
    );
  }
}

async function checkAuthContextRoute(): Promise<DiagnosticResult> {
  try {
    const context = await fetchAuthContext();
    return renderCheckResult(
      "authRoute",
      context.user.emailVerified ? "pass" : "warn",
      context.user.emailVerified
        ? "The browser can refresh /api/auth-context successfully."
        : "The auth context loaded, but the current user's email is not verified.",
      `User: ${context.user.email}\nWorkspace: ${context.workspace.name}\nRole: ${context.role}`,
    );
  } catch (err) {
    const apiError = readApiError(err);
    if (apiError) {
      return renderCheckResult(
        "authRoute",
        "fail",
        `/api/auth-context returned status ${apiError.status}.`,
        formatError(apiError.body),
      );
    }
    return renderCheckResult(
      "authRoute",
      "fail",
      "/api/auth-context could not be reached.",
      formatError(err),
    );
  }
}

function formatError(body: unknown): string {
  if (body instanceof Error) return body.message;
  if (typeof body === "string") return body;
  return formatJson(body);
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
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
