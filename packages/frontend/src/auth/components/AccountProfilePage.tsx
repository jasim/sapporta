import {
  Building2,
  CheckCircle2,
  Copy,
  KeyRound,
  Mail,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "@sapporta/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@sapporta/ui/dialog";
import { Input } from "@sapporta/ui/input";
import { Label } from "@sapporta/ui/label";
import type { AuthToken } from "@sapporta/shared/contracts";
import {
  createAuthToken,
  listAuthTokens,
  revokeAuthToken,
} from "../api/auth-context";
import { useAuthStore } from "../state/auth-store";
import {
  formatAuthRole,
  getAccountDisplayName,
  getAccountInitials,
} from "../../shell/components/AccountMenu";
import { getApiBase } from "../../platform/base";
import { AppPage } from "../../shell/components/Page";

export function AccountProfilePage() {
  const session = useAuthStore((s) => s.session);

  if (session.kind === "unknown" || session.kind === "loading") {
    return (
      <AppPage
        title="Account profile"
        bodyClassName="flex items-center justify-center text-sap-muted"
      >
        Loading...
      </AppPage>
    );
  }

  if (session.kind !== "authenticated") {
    return (
      <AppPage
        title="Account profile"
        bodyClassName="flex items-center justify-center text-sap-muted"
      >
        Not signed in.
      </AppPage>
    );
  }

  const { context } = session;
  const displayName = getAccountDisplayName(context.user);
  const initials = getAccountInitials(context.user);

  return (
    <AppPage title="Account profile">
      <div className="mx-auto w-full max-w-[760px] px-6 py-8">
        <div className="mb-7 flex items-center gap-3">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[7px] bg-sap-active-nav text-sap-body font-bold text-sap-brand">
            {initials}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[22px] font-[680] leading-tight text-sap-fg">
              {displayName}
            </h2>
            <p className="mt-1 truncate text-sap-body text-sap-muted">
              {context.user.email}
            </p>
          </div>
        </div>

        <section className="border-y border-sap-border-soft">
          <ProfileRow
            icon={<UserRound className="h-4 w-4" strokeWidth={1.7} />}
            label="Name"
            value={displayName}
          />
          <ProfileRow
            icon={<Mail className="h-4 w-4" strokeWidth={1.7} />}
            label="Email"
            value={context.user.email}
          />
          <ProfileRow
            icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />}
            label="Email status"
            value={context.user.emailVerified ? "Verified" : "Unverified"}
          />
        </section>

        <section className="mt-8 border-y border-sap-border-soft">
          <ProfileRow
            icon={<Building2 className="h-4 w-4" strokeWidth={1.7} />}
            label="Workspace"
            value={context.workspace.name}
          />
          <ProfileRow
            icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.7} />}
            label="Role"
            value={formatAuthRole(context.role)}
          />
        </section>

        <AccountSecurity />
        <AgentAccessTokens />
      </div>
    </AppPage>
  );
}

function AccountSecurity() {
  return (
    <section className="mt-8">
      <header className="mb-3 flex items-center gap-2">
        <KeyRound className="size-4 text-sap-subtle" strokeWidth={1.7} />
        <h2 className="text-[17px] font-[680] text-sap-fg">Security</h2>
      </header>
      <div className="flex min-h-[70px] flex-wrap items-center justify-between gap-4 border-y border-sap-border-soft py-3">
        <div className="min-w-0">
          <div className="text-sap-body font-medium text-sap-fg">Password</div>
          <p className="mt-1 text-sap-data text-sap-muted">
            Use your current password to choose a new one.
          </p>
        </div>
        <Link
          className={buttonVariants({ variant: "outline" })}
          to="/account/password"
        >
          Change password
        </Link>
      </div>
    </section>
  );
}

type ExpirationChoice = "never" | "date";
const tokenNameSuffixLength = 4;

function AgentAccessTokens() {
  const [tokens, setTokens] = useState<AuthToken[]>([]);
  const [isCreateFormOpen, setCreateFormOpen] = useState(false);
  const [name, setName] = useState(createDefaultTokenName);
  const [expiresAt, setExpiresAt] = useState("");
  const [expirationChoice, setExpirationChoice] =
    useState<ExpirationChoice>("never");
  // The raw bearer token is returned only when it is created. Keep it in this
  // view long enough for the user to copy it into an agent or CI secret; token
  // list responses show metadata only.
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listAuthTokens()
      .then((result) => {
        if (!cancelled) setTokens(result.tokens);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const created = await createAuthToken({
        name,
        ...(expirationChoice === "date" && expiresAt
          ? { expiresAt: new Date(expiresAt).toISOString() }
          : {}),
      });
      setRawToken(created.rawToken);
      setTokens((current) => [created.token, ...current]);
      setName(createDefaultTokenName());
      setExpiresAt("");
      setExpirationChoice("never");
      setCreateFormOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    setPending(true);
    setError(null);
    try {
      await revokeAuthToken(id);
      const revokedAt = new Date().toISOString();
      setTokens((current) =>
        current.map((token) =>
          token.id === id ? { ...token, revokedAt } : token,
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function copyText(value: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      throw new Error("Clipboard is not available.");
    }
    await navigator.clipboard.writeText(value);
  }

  return (
    <section className="mt-8">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-sap-subtle" strokeWidth={1.7} />
          <h2 className="text-[17px] font-[680] text-sap-fg">
            Agent access tokens
          </h2>
        </div>
        {!isCreateFormOpen ? (
          <Button
            type="button"
            className="bg-sap-brand text-white hover:bg-sap-brand/90"
            onClick={() => {
              setName(createDefaultTokenName());
              setCreateFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" strokeWidth={1.9} />
            Create new access token
          </Button>
        ) : null}
      </header>

      {isCreateFormOpen ? (
        <form
          className="grid gap-4 border-y border-sap-border-soft py-4"
          onSubmit={submit}
        >
          <div className="space-y-2">
            <Label htmlFor="agent-token-name">Token name</Label>
            <Input
              id="agent-token-name"
              className="border-sap-border bg-sap-surface text-sap-fg focus-visible:ring-sap-brand"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <p className="text-sap-data text-sap-muted">
              Use a name that tells you where this token will be used.
            </p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium leading-none text-sap-fg">
              Expiration
            </legend>
            <p className="text-sap-data text-sap-muted">
              Choose whether this token should expire automatically.
            </p>
            <label className="flex items-start gap-3 text-sap-body text-sap-fg">
              <input
                className="mt-[3px] h-4 w-4 accent-sap-brand"
                type="radio"
                name="agent-token-expiration"
                value="never"
                checked={expirationChoice === "never"}
                onChange={() => setExpirationChoice("never")}
              />
              <span>
                <span className="block font-medium">Never expires</span>
                <span className="block text-sap-data text-sap-muted">
                  Keep this token active until you revoke it.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sap-body text-sap-fg">
              <input
                className="mt-[3px] h-4 w-4 accent-sap-brand"
                type="radio"
                name="agent-token-expiration"
                value="date"
                checked={expirationChoice === "date"}
                onChange={() => setExpirationChoice("date")}
              />
              <span>
                <span className="block font-medium">Expires on a date</span>
                <span className="block text-sap-data text-sap-muted">
                  Set a specific date and time for this token to stop working.
                </span>
              </span>
            </label>
            {expirationChoice === "date" ? (
              <div className="space-y-2 pl-7">
                <Label htmlFor="agent-token-expires-at">Expiration date</Label>
                <Input
                  id="agent-token-expires-at"
                  className="max-w-[260px] border-sap-border bg-sap-surface text-sap-fg focus-visible:ring-sap-brand"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                  required
                />
              </div>
            ) : null}
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              className="bg-sap-brand text-white hover:bg-sap-brand/90"
              disabled={
                pending ||
                name.trim().length === 0 ||
                (expirationChoice === "date" && expiresAt.length === 0)
              }
            >
              Create token
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-sap-border bg-sap-surface text-sap-muted hover:text-sap-fg"
              onClick={() => {
                setCreateFormOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <CreatedTokenDialog
        rawToken={rawToken}
        onClose={() => setRawToken(null)}
        onCopy={copyText}
      />

      {error ? (
        <p className="mt-3 text-sap-data text-red-600">{error}</p>
      ) : null}

      <div className="mt-4 border-y border-sap-border-soft">
        {tokens.length === 0 ? (
          <div className="py-4 text-sap-body text-sap-muted">No tokens.</div>
        ) : (
          tokens.map((token) => (
            <div
              className="grid min-h-[54px] grid-cols-[minmax(0,1fr)_120px_36px] items-center gap-3 border-b border-sap-border-soft py-3 last:border-b-0"
              key={token.id}
            >
              <div className="min-w-0">
                <div className="truncate text-sap-body font-medium text-sap-fg">
                  {token.name}
                </div>
                <div className="truncate text-sap-data text-sap-muted">
                  {token.revokedAt
                    ? "Revoked"
                    : token.expiresAt
                      ? `Expires ${formatDate(token.expiresAt)}`
                      : "No expiration"}
                </div>
              </div>
              <div className="truncate text-right text-sap-data text-sap-muted">
                {token.lastUsedAt ? formatDate(token.lastUsedAt) : "Never used"}
              </div>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-[7px] border border-sap-border bg-sap-surface text-sap-muted hover:text-red-600 disabled:opacity-50"
                type="button"
                title="Revoke token"
                disabled={pending || token.revokedAt !== null}
                onClick={() => void revoke(token.id)}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function createDefaultTokenName(): string {
  return `Agent Token ${randomTokenNameSuffix()}`;
}

function randomTokenNameSuffix(): string {
  const value =
    globalThis.crypto?.randomUUID() ?? Math.random().toString(36).slice(2);
  return value.replaceAll("-", "").slice(0, tokenNameSuffixLength);
}

function CreatedTokenDialog({
  rawToken,
  onClose,
  onCopy,
}: {
  rawToken: string | null;
  onClose: () => void;
  onCopy: (value: string) => Promise<void>;
}) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    setCopyStatus("idle");
  }, [rawToken]);

  useEffect(() => {
    if (copyStatus === "idle") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 2200);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  async function handleCopy(value: string, target: CopyTarget) {
    try {
      await onCopy(value);
      setCopyStatus(target === "token" ? "token-copied" : "prompt-copied");
    } catch {
      setCopyStatus(target === "token" ? "token-failed" : "prompt-failed");
    }
  }

  const setupPrompt = rawToken
    ? createAgentSetupPrompt(resolveCliApiUrl(), rawToken)
    : "";

  return (
    <Dialog
      open={rawToken !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[840px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-sap-border bg-sap-surface p-0 text-sap-fg">
        <DialogHeader className="border-b border-sap-border-soft px-6 py-5 pr-12">
          <div className="flex items-start gap-3 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-sap-active-nav text-sap-brand">
              <KeyRound className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[18px] font-[680]">
                New access token created
              </DialogTitle>
              <DialogDescription className="mt-2 text-sap-body text-sap-muted">
                Save the token or copy the agent setup prompt before closing.
                The token will not be shown again.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
          <section className="rounded-[9px] border border-sap-border-soft p-4">
            <div>
              <h3 className="text-sap-body font-[650] text-sap-fg">
                Access token
              </h3>
              <p className="mt-1 text-sap-data text-sap-muted">
                Copy the token by itself if you want to configure the
                environment manually.
              </p>
            </div>
            <div className="mt-4 grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                aria-label="New agent access token"
                className="h-10 min-w-0 border-sap-border bg-sap-surface font-mono text-[12px] text-sap-fg"
                value={rawToken ?? ""}
                readOnly
              />
              <Button
                type="button"
                variant="outline"
                className="h-10 border-sap-border bg-sap-surface text-sap-fg"
                onClick={() => {
                  if (rawToken) void handleCopy(rawToken, "token");
                }}
              >
                <Copy className="h-4 w-4" strokeWidth={1.8} />
                Copy token
              </Button>
            </div>
            <CopyFeedback status={copyStatus} target="token" />
          </section>

          <section className="rounded-[9px] border border-sap-border-soft p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sap-body font-[650] text-sap-fg">
                  Set up a coding agent
                </h3>
                <p className="mt-1 text-sap-data text-sap-muted">
                  Paste this prompt into an agent opened in the project
                  directory.
                </p>
              </div>
              <Button
                type="button"
                className="bg-sap-brand text-white hover:bg-sap-brand/90"
                onClick={() => void handleCopy(setupPrompt, "prompt")}
              >
                <Copy className="h-4 w-4" strokeWidth={1.8} />
                Copy setup prompt
              </Button>
            </div>
            <pre className="mt-4 max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-sap-border-soft bg-sap-nested p-4 font-mono text-[12px] leading-5 text-sap-fg">
              {setupPrompt}
            </pre>
            <div className="mt-2">
              <CopyFeedback status={copyStatus} target="prompt" />
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-sap-border-soft px-6 py-4">
          <DialogClose
            render={
              <Button
                type="button"
                variant="outline"
                className="border-sap-border bg-sap-surface text-sap-muted hover:text-sap-fg"
              />
            }
          >
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CopyTarget = "token" | "prompt";
type CopyStatus =
  "idle" | "token-copied" | "token-failed" | "prompt-copied" | "prompt-failed";

function CopyFeedback({
  status,
  target,
}: {
  status: CopyStatus;
  target: CopyTarget;
}) {
  const copied = status === `${target}-copied`;
  const failed = status === `${target}-failed`;
  const message = copied
    ? target === "token"
      ? "Token copied to clipboard."
      : "Setup prompt copied to clipboard."
    : failed
      ? "Could not copy. Select the text and copy it manually."
      : null;

  return (
    <div className="min-h-[18px] flex-1">
      {message ? (
        <p
          className={
            copied
              ? "text-sap-data text-sap-brand"
              : "text-sap-data text-red-600"
          }
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function resolveCliApiUrl(): string {
  const browserOrigin =
    typeof window === "undefined"
      ? "http://localhost:3000"
      : window.location.origin;
  const apiBaseUrl = new URL(getApiBase(), `${browserOrigin}/`);
  return apiBaseUrl.href.replace(/\/api\/?$/, "");
}

function createAgentSetupPrompt(apiUrl: string, apiToken: string): string {
  return [
    "Prepare this directory so coding agents can understand and work with the application using the Sapporta skill and authenticated CLI.",
    "Ensure the Sapporta skill is available; if not, run `npx skills add 'https://github.com/jasim/sapporta-skills' --skill sapporta`.",
    "Ensure a project-local CLI exists; if not, run `pnpm install sapporta`.",
    `Configure the CLI to access \`${apiUrl}\` using this private access token: \`${apiToken}\`.`,
    "Make `SAPPORTA_API_URL` and `SAPPORTA_API_TOKEN` available to every Sapporta command through the project's existing directory environment tooling, such as mise, direnv, or a dotenv runner.",
    "If none exists, use a small private, gitignored local wrapper; do not install an environment manager just for this.",
    "Update `AGENTS.md` with the exact authenticated command agents should use, using an absolute path for a wrapper.",
    "Keep the token out of version control and handle it as a secret.",
    `Verify access with the read-only \`endpoints list\` command, requesting sandbox network access to \`${apiUrl}\` if needed.`,
  ].join(" ");
}

function ProfileRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid min-h-[54px] grid-cols-[24px_150px_minmax(0,1fr)] items-center gap-3 border-b border-sap-border-soft py-3 last:border-b-0">
      <span className="flex h-6 w-6 items-center justify-center text-sap-subtle">
        {icon}
      </span>
      <span className="text-sap-data font-medium text-sap-muted">{label}</span>
      <span className="min-w-0 truncate text-sap-body text-sap-fg">
        {value}
      </span>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Request failed";
}
