import { type ReactNode, useEffect, useState } from "react";
import {
  fetchAuthContext,
  useAuthStore,
  type AuthSession,
} from "@sapporta/frontend/auth/runtime";
import { getApiBase } from "@sapporta/frontend/platform";
import { useSchemaStore } from "@sapporta/frontend/schema";
import { Button, buttonVariants } from "@sapporta/ui/button";
import { cn } from "@sapporta/ui/cn";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  SearchCheck,
  Stethoscope,
} from "lucide-react";

const sapportaDocsUrl = "https://github.com/jasim/sapporta/tree/main/docs";

const projectReferences = `Read README.md and AGENTS.md first. Follow the Sapporta skill and the getting-started guide: https://sapporta.com/docs/getting-started`;

const appIdeas = [
  {
    id: "tasks",
    label: "Task Management",
    category: "Productivity",
    description:
      "Plan projects, assign work, track due dates, and review progress.",
    prompt: `Build a focused task management app with Sapporta.

Model people, projects, tasks, labels, and comments.

Include:
- task creation and assignment
- status, priority, due dates, labels, and comments
- views for open tasks, overdue tasks, assignees, and projects

Add realistic sample data. Keep the first version small and follow the existing project structure.`,
  },
  {
    id: "invoices",
    label: "Invoicing",
    category: "Business",
    description:
      "Create quotes and invoices, record payments, and monitor unpaid balances.",
    prompt: `Build a focused invoicing app with Sapporta.

Model customers, catalog items, quotes, invoices, line items, and payments.

Include:
- invoice entry with line items and calculated totals
- draft, sent, overdue, and paid states
- views for revenue, unpaid invoices, payment history, and item sales

Add realistic sample data. Keep the first version small and follow the existing project structure.`,
  },
  {
    id: "meals",
    label: "Meal Tracking",
    category: "Personal",
    description:
      "Log meals, track nutrition targets, and review daily and weekly totals.",
    prompt: `Build a focused meal tracking app with Sapporta.

Model foods, serving units, meals, meal items, daily targets, and measurements.

Include:
- meal logging with several foods
- copying a previous meal into today
- views for daily totals, weekly averages, macro balance, and food history

Add realistic sample data. Keep the first version small and follow the existing project structure.`,
  },
] as const;

type AppIdea = (typeof appIdeas)[number];

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
      <div className="mx-auto max-w-[68rem] px-5 py-5 sm:px-8 sm:py-7 lg:px-10">
        {viewMode === "diagnostics" ? (
          <>
            <PageNav>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode("onboarding")}
              >
                Welcome
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={runDiagnostics}
                disabled={diagnosticsRunning}
              >
                <SearchCheck data-icon="inline-start" strokeWidth={1.8} />
                {diagnosticsRunning ? "Running" : "Run again"}
              </Button>
            </PageNav>

            <header className="max-w-[44rem] pb-7 pt-10 sm:pt-12">
              <div className="text-sap-label font-bold uppercase tracking-sap-section text-sap-muted">
                Project diagnostics
              </div>
              <h1 className="mt-3 text-2xl font-[720] leading-tight text-sap-soft sm:text-[30px]">
                Check the project connections
              </h1>
              <p className="mt-3 max-w-[38rem] text-[15px] leading-6 text-sap-muted">
                Run these checks when schema metadata, API routes, or the
                workspace session do not load as expected.
              </p>
            </header>

            <section className="border-t border-sap-border-soft py-7">
              <div className="grid max-w-[50rem] gap-3">
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
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "no-underline",
                )}
                href={sapportaDocsUrl}
                rel="noreferrer"
                target="_blank"
              >
                Docs
                <ExternalLink data-icon="inline-end" strokeWidth={1.8} />
              </a>
              <Button variant="ghost" size="sm" onClick={openDiagnostics}>
                <Stethoscope data-icon="inline-start" strokeWidth={1.8} />
                Diagnostics
              </Button>
            </PageNav>

            <header className="max-w-[44rem] pt-12 sm:pt-16">
              <h1 className="text-[24px] font-[680] leading-tight text-sap-soft sm:text-[28px]">
                Welcome to your new Sapporta project
              </h1>
              <p className="mt-4 text-[15px] leading-6 text-sap-muted">
                Start building your application by prompting a coding agent.
                Here are a few sample prompts to get started.
              </p>
            </header>

            <main className="max-w-[58rem] py-9 sm:py-11">
              <section aria-labelledby="starter-heading">
                <h2
                  className="mb-3 text-[16px] font-[680] text-sap-soft"
                  id="starter-heading"
                >
                  Sample prompts
                </h2>
                <div
                  aria-label="Starter app choices"
                  className="grid gap-2 sm:grid-cols-3"
                  role="group"
                >
                  {appIdeas.map((idea) => (
                    <button
                      aria-pressed={selectedIdea.id === idea.id}
                      className={cn(
                        "min-h-[108px] cursor-pointer rounded-lg bg-sap-sidebar px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sap-bg",
                        selectedIdea.id === idea.id
                          ? "bg-sap-brand-soft text-sap-fg"
                          : "text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg",
                      )}
                      key={idea.id}
                      type="button"
                      onClick={() => setSelectedIdeaId(idea.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-1">
                          <div className="text-sap-micro font-bold uppercase tracking-sap-label text-sap-muted">
                            {idea.category}
                          </div>
                          <div className="text-[14px] font-[650] leading-5">
                            {idea.label}
                          </div>
                        </div>
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full border",
                            selectedIdea.id === idea.id
                              ? "border-sap-brand bg-sap-surface"
                              : "border-sap-border-strong bg-sap-surface",
                          )}
                        >
                          {selectedIdea.id === idea.id ? (
                            <span className="size-2 rounded-full bg-sap-brand" />
                          ) : null}
                        </span>
                      </div>
                      <div className="mt-2 text-sap-body leading-5 text-sap-muted">
                        {idea.description}
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section
                aria-labelledby="prompt-heading"
                className="mt-10 min-w-0"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2
                      className="text-[16px] font-[680] text-sap-soft"
                      id="prompt-heading"
                    >
                      {selectedIdea.label} prompt
                    </h2>
                    <p className="mt-1 text-sap-body text-sap-muted">
                      Paste this into your coding agent from the project root.
                    </p>
                  </div>
                  <Button size="sm" onClick={copyAgentPrompt}>
                    {copyStatus === "copied" ? (
                      <Check data-icon="inline-start" strokeWidth={2} />
                    ) : (
                      <Copy data-icon="inline-start" strokeWidth={1.9} />
                    )}
                    <span aria-live="polite">
                      {copyStatus === "copied"
                        ? "Copied"
                        : copyStatus === "error"
                          ? "Copy failed"
                          : "Copy prompt"}
                    </span>
                  </Button>
                </div>

                <pre className="mono mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sap-sidebar p-5 text-[13px] leading-6 text-sap-soft sm:p-6">
                  {activePrompt}
                </pre>
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
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="size-4 rounded-[5px] bg-[linear-gradient(135deg,var(--sap-fg)_0_58%,var(--sap-brand)_58%_100%)]"
        />
        <div className="text-sap-data font-[680] text-sap-soft">Sapporta</div>
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
        ? "text-sap-warning"
        : "text-sap-negative";

  return (
    <div className="grid gap-3 rounded-lg border border-sap-border-soft bg-sap-surface px-4 py-4 shadow-sm sm:grid-cols-[104px_minmax(0,1fr)] sm:px-5">
      <div
        className={cn(
          "flex items-center gap-2 text-sap-data font-semibold",
          statusClass,
        )}
      >
        {result.status === "pass" ? (
          <Check className="size-4" strokeWidth={2} />
        ) : (
          <AlertTriangle className="size-4" strokeWidth={1.9} />
        )}
        {statusLabel(result.status)}
      </div>
      <div className="min-w-0">
        <div className="text-sap-body font-semibold text-sap-soft">
          {result.label}
        </div>
        <p className="mt-1 text-sap-data leading-5 text-sap-soft">
          {result.message}
        </p>
        {result.detail ? (
          <pre className="mono mt-3 whitespace-pre-wrap break-words rounded-md border border-sap-border-soft bg-sap-nested p-3 text-sap-micro leading-5 text-sap-soft">
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
