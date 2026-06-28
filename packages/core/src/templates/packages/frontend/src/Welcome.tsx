import { type ReactNode, useEffect, useState } from "react";
import {
  fetchAuthContext,
  useAuthStore,
  type AuthSession,
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

const projectReferences = `Before changing the app, review:
- [README.md](README.md)
- [AGENTS.md](AGENTS.md)
- [Sapporta coding-agent skill](https://github.com/jasim/sapporta-skills/tree/main/skills/sapporta)`;

const appIdeas = [
  {
    id: "tasks",
    label: "Task Management",
    eyebrow: "Productivity",
    description:
      "Plan projects, assign work, track due dates, and review progress.",
    prompt: `Build a simple task management application.
Use Sapporta, the database framework for TypeScript, and ensure the Sapporta skill is installed. Follow the setup instructions at https://sapporta.com/docs/getting-started

Keep the first version focused and easy to understand: include the core workflows that make the app useful, and avoid exhaustive features or deep customization.

Use workspaceGlobal tables with this exact contract: people(id, name, email), projects(id, name, description, status), tasks(id, title, description, status, priority, due_date, assignee_id, project_id), labels(id, name, color), task_labels(id, task_id, label_id), comments(id, task_id, author_id, body). Use status values open, in_progress, blocked, done; priorities low, normal, high; and project statuses active, paused, complete. Do not expose workspace_id, workspaceId, scoped_to_user_id, or scopedToUserId in clients, CLI commands, or agent prompts.

Include workflows for creating a task, assigning it, changing its status, and adding a comment. Include reports for open tasks, overdue tasks, tasks by assignee, and tasks by project. Populate the application with realistic sample projects, people, tasks, labels, and comments so the first run shows an active todo app.`,
  },
  {
    id: "invoices",
    label: "Invoicing",
    eyebrow: "Business",
    description:
      "Create quotes and invoices, record payments, and monitor unpaid balances.",
    prompt: `Build an invoicing application.
Use Sapporta, the database framework for TypeScript, and ensure the Sapporta skill is installed. Follow the setup instructions at https://sapporta.com/docs/getting-started

Keep the first version focused and easy to understand: include the core workflows that make the app useful, and avoid exhaustive features or deep customization.

The application should manage customers, contacts, products or services, quotes, quote line items, invoices, invoice line items, payments, and payment allocations. Invoice totals should come from line items, and invoice status should move from draft to sent to paid.

Include a workflow where a user can enter an invoice and its line items together. Include reports for monthly revenue, unpaid invoices, overdue receivables, customer payment history, and product or service sales. Populate the application with realistic sample customers, products or services, invoices, payments, and receivables activity so the first run feels complete.`,
  },
  {
    id: "meals",
    label: "Meal Tracking",
    eyebrow: "Personal Database",
    description:
      "Log meals, track nutrition targets, and review daily and weekly totals.",
    prompt: `Build a meal and nutrition tracking application.
Use Sapporta, the database framework for TypeScript, and ensure the Sapporta skill is installed. Follow the setup instructions at https://sapporta.com/docs/getting-started

Keep the first version focused and easy to understand: include the core workflows that make the app useful, and avoid exhaustive features or deep customization.

The application should manage foods, serving units, meals, meal items, daily targets, body measurements, and nutrition goals. Track calories, protein, carbs, fat, fiber, and serving sizes. Users should be able to move from a day to its meals and from a food to its usage history.

Include workflows for logging a meal with multiple foods and copying a previous meal into today. Include reports for daily nutrition totals, weekly averages, macro balance, calorie trend, and foods eaten most often. Populate the application with realistic sample foods, meals, targets, and nutrition logs so the first run shows meaningful daily and weekly totals.`,
  },
] as const;

type AppIdea = (typeof appIdeas)[number];

const navButtonClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[2px] bg-transparent px-3 text-sap-data font-semibold text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg disabled:opacity-70";

const primaryButtonClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-[2px] bg-sap-fg px-3 text-sap-data font-semibold text-sap-bg hover:opacity-90";

const eyebrowClass =
  "text-sap-label font-bold uppercase tracking-sap-section text-sap-link";

// Replace this screen with the first dashboard, workflow, or form your app
// needs after the app has its own primary surface.
export function Welcome() {
  const { tables, loaded, error, name, slug } = useSchemaStore();
  const authSession = useAuthStore((s) => s.session);
  const [selectedIdeaId, setSelectedIdeaId] = useState<AppIdea["id"]>("tasks");
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
      authStoreCheck(authSession),
    ]);

    const results = await Promise.all([
      checkHelloRoute(),
      checkAuthContextRoute(),
    ]);

    setDiagnostics((current) => [...current, ...results]);
    setDiagnosticsRunning(false);
  }

  return (
    <div className="flex-1 overflow-y-auto bg-sap-bg text-sap-fg">
      <div className="mx-auto max-w-[96rem] px-5 py-6 sm:px-10 lg:px-16">
        {viewMode === "diagnostics" ? (
          <>
            <PageNav>
              <button
                className={navButtonClass}
                type="button"
                onClick={() => setViewMode("onboarding")}
              >
                Welcome
              </button>
              <button
                className={navButtonClass}
                type="button"
                onClick={runDiagnostics}
                disabled={diagnosticsRunning}
              >
                <SearchCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
                {diagnosticsRunning ? "Running" : "Run again"}
              </button>
            </PageNav>

            <header className="max-w-[58rem] pb-8 pt-10 sm:pt-14">
              <div className={eyebrowClass}>Project diagnostics</div>
              <h1 className="mt-4 text-[42px] font-[830] leading-[0.96] text-sap-fg sm:text-[64px]">
                Check the frontend, API, schema, and auth connection.
              </h1>
              <p className="mt-6 max-w-[42rem] text-[17px] leading-7 text-sap-soft">
                Use these checks when the page renders but metadata, custom API
                routes, or the workspace context need attention.
              </p>
            </header>

            <section className="border-t border-sap-border py-8">
              <div className="grid max-w-[58rem] gap-2">
                {diagnostics.map((result) => (
                  <DiagnosticRow key={result.id} result={result} />
                ))}
              </div>
            </section>
          </>
        ) : (
          <>
            <PageNav>
              <a
                className={navButtonClass}
                href={sapportaDocsUrl}
                rel="noreferrer"
                target="_blank"
              >
                Docs
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
              </a>
              <button
                className={navButtonClass}
                type="button"
                onClick={openDiagnostics}
              >
                <Stethoscope className="h-3.5 w-3.5" strokeWidth={1.8} />
                Diagnostics
              </button>
            </PageNav>

            <header className="max-w-[44rem] pb-8 pt-10 sm:pt-14">
              <h1 className="text-[21px] font-[830] leading-[0.96] text-sap-fg sm:text-[32px]">
                Build your database app with Sapporta
              </h1>
              <p className="mt-4 text-[17px] leading-7 text-sap-soft">
                Choose a starter prompt, and copy it into your coding agent.
              </p>
            </header>

            <main className="max-w-[58rem] py-6">
              <section>
                <div className="grid gap-2 sm:grid-cols-3">
                  {appIdeas.map((idea) => (
                    <button
                      className={[
                        "rounded-[4px] px-4 py-4 text-left ring-1 transition-colors",
                        selectedIdea.id === idea.id
                          ? "bg-sap-active-nav text-sap-fg ring-sap-border-strong"
                          : "bg-sap-sidebar text-sap-soft ring-sap-border-soft hover:bg-sap-row-hover hover:text-sap-fg",
                      ].join(" ")}
                      key={idea.id}
                      type="button"
                      onClick={() => setSelectedIdeaId(idea.id)}
                    >
                      <div className="text-sap-micro font-bold uppercase tracking-sap-label text-sap-muted">
                        {idea.eyebrow}
                      </div>
                      <div className="mt-1 text-[15px] font-[720] leading-5">
                        {idea.label}
                      </div>
                      <div className="mt-1 text-sap-body leading-5 text-sap-muted">
                        {idea.description}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="mt-8 min-w-0">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className={eyebrowClass}>Prompt</div>
                    <h2 className="mt-2 text-[26px] font-[760] leading-tight text-sap-fg">
                      {selectedIdea.label}
                    </h2>
                  </div>
                  <button
                    className={primaryButtonClass}
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
                        : "Copy Prompt"}
                  </button>
                </div>

                <div className="overflow-hidden rounded-[4px] bg-sap-sidebar">
                  <pre className="mono max-h-[560px] overflow-auto whitespace-pre-wrap p-5 text-[13px] leading-6 text-sap-fg">
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

function PageNav({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sap-label font-[780] uppercase leading-none text-sap-subtle">
        Sapporta
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Welcome actions">
        {children}
      </nav>
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
    <div className="grid gap-3 rounded-[2px] border border-sap-border bg-sap-surface px-4 py-3 sm:grid-cols-[120px_minmax(0,1fr)]">
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

function authStoreCheck(session: AuthSession): DiagnosticResult {
  if (session.kind === "authenticated") {
    return renderCheckResult(
      "authStore",
      "pass",
      "The protected app shell has an authenticated user and workspace context.",
    );
  }
  if (session.kind === "failed") {
    return renderCheckResult(
      "authStore",
      "fail",
      "The app shell could not load the current session.",
      session.error,
    );
  }
  return renderCheckResult(
    "authStore",
    "warn",
    `The current session is "${session.kind}". If this page is visible unexpectedly, inspect /api/auth-context and the auth gate.`,
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
