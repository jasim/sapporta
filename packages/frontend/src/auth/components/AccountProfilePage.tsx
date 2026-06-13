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
import type { AuthToken } from "@sapporta/shared/contracts";
import {
  createAuthToken,
  listAuthTokens,
  revokeAuthToken,
} from "@/auth/api/auth-context";
import { useAuthStore } from "@/auth/state/auth-store";
import {
  formatAuthRole,
  getAccountDisplayName,
  getAccountInitials,
} from "@/shell/components/AccountMenu";

export function AccountProfilePage() {
  const context = useAuthStore((s) => s.context);
  const status = useAuthStore((s) => s.status);
  const load = useAuthStore((s) => s.load);

  useEffect(() => {
    if (status === "idle") void load();
  }, [load, status]);

  if (status === "idle" || status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sap-muted">
        Loading...
      </div>
    );
  }

  if (!context) {
    return (
      <div className="flex h-full items-center justify-center text-sap-muted">
        Not signed in.
      </div>
    );
  }

  const displayName = getAccountDisplayName(context.user);
  const initials = getAccountInitials(context.user);

  return (
    <div className="min-h-full bg-sap-surface">
      <div className="mx-auto w-full max-w-[760px] px-6 py-8">
        <header className="mb-7 flex items-center gap-3">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[7px] bg-sap-active-nav text-sap-body font-bold text-sap-brand">
            {initials}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-[680] leading-tight text-sap-fg">
              Account profile
            </h1>
            <p className="mt-1 truncate text-sap-body text-sap-muted">
              {displayName}
            </p>
          </div>
        </header>

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

        <AgentAccessTokens />
      </div>
    </div>
  );
}

function AgentAccessTokens() {
  const [tokens, setTokens] = useState<AuthToken[]>([]);
  const [name, setName] = useState("codex-local");
  const [expiresAt, setExpiresAt] = useState("");
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
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
      setRawToken(created.rawToken);
      setTokens((current) => [created.token, ...current]);
      setName("codex-local");
      setExpiresAt("");
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

  async function copyRawToken() {
    if (!rawToken) return;
    await navigator.clipboard.writeText(rawToken);
  }

  return (
    <section className="mt-8">
      <header className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-sap-subtle" strokeWidth={1.7} />
        <h2 className="text-[17px] font-[680] text-sap-fg">
          Agent access tokens
        </h2>
      </header>

      <form
        className="grid gap-3 border-y border-sap-border-soft py-4 sm:grid-cols-[minmax(0,1fr)_210px_36px]"
        onSubmit={submit}
      >
        <input
          className="h-9 min-w-0 rounded-[7px] border border-sap-border bg-sap-panel px-3 text-sap-body text-sap-fg outline-none focus:border-sap-brand"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Token name"
          required
        />
        <input
          className="h-9 min-w-0 rounded-[7px] border border-sap-border bg-sap-panel px-3 text-sap-body text-sap-fg outline-none focus:border-sap-brand"
          type="datetime-local"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
          aria-label="Expiration"
        />
        <button
          className="flex h-9 w-9 items-center justify-center rounded-[7px] bg-sap-brand text-white disabled:opacity-60"
          type="submit"
          title="Create token"
          disabled={pending || name.trim().length === 0}
        >
          <Plus className="h-4 w-4" strokeWidth={1.9} />
        </button>
      </form>

      {rawToken ? (
        <div className="mt-4 grid gap-2 border-y border-sap-border-soft py-3 sm:grid-cols-[minmax(0,1fr)_36px]">
          <input
            className="h-9 min-w-0 rounded-[7px] border border-sap-border bg-sap-panel px-3 font-mono text-[12px] text-sap-fg outline-none"
            value={rawToken}
            readOnly
            aria-label="New agent access token"
          />
          <button
            className="flex h-9 w-9 items-center justify-center rounded-[7px] border border-sap-border bg-sap-panel text-sap-muted hover:text-sap-fg"
            type="button"
            title="Copy token"
            onClick={copyRawToken}
          >
            <Copy className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      ) : null}

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
                className="flex h-9 w-9 items-center justify-center rounded-[7px] border border-sap-border bg-sap-panel text-sap-muted hover:text-red-600 disabled:opacity-50"
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
