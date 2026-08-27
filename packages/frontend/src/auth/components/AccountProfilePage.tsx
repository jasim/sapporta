import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Copy,
  Globe,
  KeyRound,
  Mail,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Button, buttonVariants } from "@sapporta/ui/button";
import { cn } from "@sapporta/ui/cn";
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
import type {
  AuthToken,
  CreateAuthTokenResponse,
} from "@sapporta/shared/contracts";
import {
  formatTemporalForDisplay,
  formatTimeZoneOffsetLabel,
  parseDateTimeLocalInputToCanonicalInstantString,
} from "@sapporta/shared/temporal";
import { appTimeZone } from "../../platform/app-time-zone";
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
          {/* Named here because every date on every screen is written on it,
              and nothing else on this page says which clock that is. */}
          <ProfileRow
            icon={<Globe className="h-4 w-4" strokeWidth={1.7} />}
            label="Time zone"
            value={workspaceZoneLabel()}
            action={
              context.workspace.isOwner ? (
                <Link
                  className={buttonVariants({ variant: "outline" })}
                  to="/workspace/settings"
                >
                  Change
                </Link>
              ) : undefined
            }
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

/**
 * The create-token dialog is a place of its own: `?token=new` on the profile
 * URL opens it, so the screen can be linked to, reloaded, and closed with the
 * browser's Back button.
 */
const createTokenParam = "token";
const createTokenValue = "new";

function AgentAccessTokens() {
  const [tokens, setTokens] = useState<AuthToken[]>([]);
  // The raw bearer token is returned only when it is created. Keep it in this
  // view long enough for the user to hand it to an agent; token list responses
  // show metadata only.
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isCreateOpen = searchParams.get(createTokenParam) === createTokenValue;

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

  function createTokenHref() {
    const next = new URLSearchParams(searchParams);
    next.set(createTokenParam, createTokenValue);
    return { pathname: location.pathname, search: `?${next.toString()}` };
  }

  function closeCreate() {
    const next = new URLSearchParams(searchParams);
    next.delete(createTokenParam);
    setSearchParams(next, { replace: true });
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

  return (
    <section className="mt-8">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-sap-subtle" strokeWidth={1.7} />
          <h2 className="text-[17px] font-[680] text-sap-fg">
            Agent access tokens
          </h2>
        </div>
        <Link
          className={cn(
            buttonVariants(),
            "bg-sap-brand text-white hover:bg-sap-brand/90",
          )}
          to={createTokenHref()}
        >
          <Plus className="h-4 w-4" strokeWidth={1.9} />
          Create new access token
        </Link>
      </header>

      <CreateTokenDialog
        open={isCreateOpen}
        onClose={closeCreate}
        onCreated={(created) => {
          setTokens((current) => [created.token, ...current]);
          setRawToken(created.rawToken);
          closeCreate();
        }}
      />

      <CreatedTokenDialog
        rawToken={rawToken}
        onClose={() => setRawToken(null)}
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

/**
 * Name it, create it. Expiry is folded away because most tokens never get one,
 * and a token is two clicks from here when it is left alone.
 */
function CreateTokenDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: CreateAuthTokenResponse) => void;
}) {
  const [name, setName] = useState(createDefaultTokenName);
  const [expirationChoice, setExpirationChoice] =
    useState<ExpirationChoice>("never");
  const [expiresAt, setExpiresAt] = useState("");
  const [isExpirationOpen, setExpirationOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Each visit creates a different token, so it starts on the defaults rather
  // than on whatever the previous visit typed.
  useEffect(() => {
    if (!open) return;
    setName(createDefaultTokenName());
    setExpirationChoice("never");
    setExpiresAt("");
    setExpirationOpen(false);
    setError(null);
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const created = await createAuthToken({
        name,
        // The control speaks zone-less wall-clock text, so the moment it
        // names is settled here, on the same clock the expiry is read back
        // on in the list below.
        ...(expirationChoice === "date" && expiresAt
          ? {
              expiresAt:
                parseDateTimeLocalInputToCanonicalInstantString(
                  expiresAt,
                  appTimeZone(),
                ) ?? undefined,
            }
          : {}),
      });
      onCreated(created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-[520px] gap-0 border-sap-border bg-sap-surface p-0 text-sap-fg">
        <form onSubmit={submit}>
          <DialogHeader className="px-6 pb-0 pr-12 pt-6 text-left">
            <DialogTitle className="text-[18px] font-[680]">
              New access token
            </DialogTitle>
            <DialogDescription className="text-sap-body text-sap-muted">
              Name it for where it will be used. It works until you revoke it.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="agent-token-name">Token name</Label>
              <Input
                id="agent-token-name"
                className="border-sap-border bg-sap-surface text-sap-fg focus-visible:ring-sap-brand"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>

            <div>
              <button
                className="flex items-center gap-1.5 text-sap-data text-sap-muted hover:text-sap-fg"
                type="button"
                aria-expanded={isExpirationOpen}
                onClick={() => setExpirationOpen((current) => !current)}
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    isExpirationOpen && "rotate-90",
                  )}
                  strokeWidth={1.9}
                />
                Expiration: {expirationSummary(expirationChoice, expiresAt)}
              </button>

              {isExpirationOpen ? (
                <fieldset className="mt-3 space-y-3 pl-[19px]">
                  <legend className="sr-only">Expiration</legend>
                  <label className="flex items-center gap-3 text-sap-body text-sap-fg">
                    <input
                      className="h-4 w-4 accent-sap-brand"
                      type="radio"
                      name="agent-token-expiration"
                      value="never"
                      checked={expirationChoice === "never"}
                      onChange={() => setExpirationChoice("never")}
                    />
                    Never expires
                  </label>
                  <label className="flex items-center gap-3 text-sap-body text-sap-fg">
                    <input
                      className="h-4 w-4 accent-sap-brand"
                      type="radio"
                      name="agent-token-expiration"
                      value="date"
                      checked={expirationChoice === "date"}
                      onChange={() => setExpirationChoice("date")}
                    />
                    Expires on a date
                  </label>
                  {expirationChoice === "date" ? (
                    <div className="space-y-2 pl-7">
                      <Label htmlFor="agent-token-expires-at">
                        Expiration date
                      </Label>
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
              ) : null}
            </div>

            {error ? (
              <p className="text-sap-data text-red-600">{error}</p>
            ) : null}
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
              Cancel
            </DialogClose>
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function expirationSummary(
  choice: ExpirationChoice,
  expiresAt: string,
): string {
  if (choice === "never") return "never expires";
  if (!expiresAt) return "pick a date";
  return formatDate(
    parseDateTimeLocalInputToCanonicalInstantString(expiresAt, appTimeZone()) ??
      expiresAt,
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

/**
 * What to do with a token that was just created. Handing the prompt to an
 * agent is the whole job, so the prompt and the button that copies it own the
 * screen; the token itself sits underneath for anyone wiring something by
 * hand, and this is the only time it is shown.
 */
function CreatedTokenDialog({
  rawToken,
  onClose,
}: {
  rawToken: string | null;
  onClose: () => void;
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
      await copyToClipboard(value);
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
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[760px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden border-sap-border bg-sap-surface p-0 text-sap-fg">
        <DialogHeader className="px-6 pb-5 pr-12 pt-6 text-left">
          <DialogTitle className="text-[18px] font-[680]">
            Access token created
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-6 pb-6">
          <ol className="grid gap-5">
            <li className="grid grid-cols-[26px_minmax(0,1fr)] items-start gap-3">
              <StepNumber>1</StepNumber>
              <div className="min-w-0 pt-[3px]">
                <h3 className="text-[17px] font-[650] leading-snug text-sap-fg">
                  Create an empty directory
                </h3>
                <p className="mt-1 text-sap-data text-sap-muted">
                  Anywhere on your machine.
                </p>
              </div>
            </li>

            <li className="grid grid-cols-[26px_minmax(0,1fr)] items-start gap-3">
              <StepNumber>2</StepNumber>
              <div className="min-w-0 pt-[3px]">
                <h3 className="text-[17px] font-[650] leading-snug text-sap-fg">
                  Paste this prompt into a coding agent opened there
                </h3>

                <div className="relative mt-3">
                  <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[9px] bg-sap-brand-soft p-4 pr-14 font-mono text-[12px] leading-5 text-sap-fg">
                    {setupPrompt}
                  </pre>
                  {/* Where a hand goes for a block of text it means to take
                      with it, before it reads far enough to find a button. */}
                  <button
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-[7px] border border-sap-border bg-sap-surface text-sap-muted shadow-sm hover:text-sap-fg"
                    type="button"
                    title="Copy prompt"
                    aria-label="Copy prompt"
                    onClick={() => void handleCopy(setupPrompt, "prompt")}
                  >
                    <Copy className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    size="lg"
                    className="bg-sap-brand text-white hover:bg-sap-brand/90"
                    onClick={() => void handleCopy(setupPrompt, "prompt")}
                  >
                    <Copy className="h-4 w-4" strokeWidth={1.8} />
                    Copy prompt
                  </Button>
                  <CopyFeedback status={copyStatus} target="prompt" />
                </div>
              </div>
            </li>

            <li className="grid grid-cols-[26px_minmax(0,1fr)] items-start gap-3">
              <StepNumber>3</StepNumber>
              <div className="min-w-0 pt-[3px]">
                <h3 className="text-[17px] font-[650] leading-snug text-sap-fg">
                  Ask the agent for what you need
                </h3>
                <p className="mt-1 text-sap-data text-sap-muted">
                  It can query, change, and add data, and even build tools on top of the API.
                </p>
              </div>
            </li>
          </ol>

          <div className="mt-7 border-t border-sap-border-soft pt-4">
            <h3 className="text-sap-data font-medium text-sap-muted">
              Access token
            </h3>
            <p className="mt-0.5 text-sap-data text-sap-subtle">
              Already in the prompt above. It is not shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Input
                aria-label="New agent access token"
                className="h-8 min-w-0 flex-1 border-sap-border-soft bg-sap-surface font-mono text-[11.5px] text-sap-muted"
                value={rawToken ?? ""}
                readOnly
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-sap-muted hover:text-sap-fg"
                onClick={() => {
                  if (rawToken) void handleCopy(rawToken, "token");
                }}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
                Copy token
              </Button>
            </div>
            <CopyFeedback status={copyStatus} target="token" />
          </div>
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
            Done
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepNumber({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-sap-active-nav text-sap-data font-[680] text-sap-brand"
    >
      {children}
    </span>
  );
}

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard is not available.");
  }
  await navigator.clipboard.writeText(value);
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
      : "Prompt copied to clipboard."
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
    "Ensure a project-local CLI exists; if not, run `pnpm install sapporta`; if pnpm blocks unapproved build scripts, approve `esbuild` and skip `better-sqlite3` unless this directory runs a local server.",
    `Configure the CLI to access \`${apiUrl}\` using this private access token: \`${apiToken}\`.`,
    "Make `SAPPORTA_API_URL` and `SAPPORTA_API_TOKEN` available to every Sapporta command through the project's existing directory environment tooling, such as mise, direnv, or a dotenv runner.",
    "If none exists, use a small private, gitignored local wrapper; do not install an environment manager just for this.",
    "Update `AGENTS.md` with the exact authenticated command agents should use, by absolute path if it goes through a wrapper.",
    "Keep the token out of version control and handle it as a secret.",
    `Verify the token with the read-only \`api get '/api/auth-context'\` command, which answers with the user and workspace the token acts as, requesting sandbox network access to \`${apiUrl}\` if needed.`,
  ].join(" ");
}

/**
 * The zone this workspace keeps, with the offset it is currently on:
 * `Asia/Kolkata UTC+05:30`. An offset rather than an abbreviation, because
 * abbreviations exist only for some zones; see `formatTimeZoneOffsetLabel`.
 * UTC is its own offset, and a row reading "UTC UTC" says nothing the first
 * word did not.
 */
function workspaceZoneLabel(): string {
  const zone = appTimeZone();
  const offset = formatTimeZoneOffsetLabel(zone);
  return offset === zone ? zone : `${zone} ${offset}`;
}

function ProfileRow({
  icon,
  label,
  value,
  action,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-[54px] grid-cols-[24px_150px_minmax(0,1fr)_auto] items-center gap-3 border-b border-sap-border-soft py-3 last:border-b-0">
      <span className="flex h-6 w-6 items-center justify-center text-sap-subtle">
        {icon}
      </span>
      <span className="text-sap-data font-medium text-sap-muted">{label}</span>
      <span className="min-w-0 truncate text-sap-body text-sap-fg">
        {value}
      </span>
      {action}
    </div>
  );
}

/**
 * A stored moment, on the wall clock this workspace keeps.
 *
 * The same zone and the same shape as a timestamp cell in a grid, so a token's
 * expiry reads the way every other moment in the app reads. Text that is not
 * a moment is shown as it arrived rather than guessed at.
 */
function formatDate(value: string): string {
  return formatTemporalForDisplay(value, "minute", appTimeZone()) ?? value;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Request failed";
}
