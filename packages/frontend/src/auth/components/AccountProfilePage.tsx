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
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@sapporta/ui";
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
  const session = useAuthStore((s) => s.session);

  if (session.kind === "unknown" || session.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sap-muted">
        Loading...
      </div>
    );
  }

  if (session.kind !== "authenticated") {
    return (
      <div className="flex h-full items-center justify-center text-sap-muted">
        Not signed in.
      </div>
    );
  }

  const { context } = session;
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

type ExpirationChoice = "never" | "date";

function AgentAccessTokens() {
  const [tokens, setTokens] = useState<AuthToken[]>([]);
  const [isCreateFormOpen, setCreateFormOpen] = useState(false);
  const [name, setName] = useState("codex-local");
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
      setName("codex-local");
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

  async function copyRawToken() {
    if (!rawToken) return;
    await navigator.clipboard.writeText(rawToken);
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
            onClick={() => setCreateFormOpen(true)}
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
        onCopy={copyRawToken}
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

function CreatedTokenDialog({
  rawToken,
  onClose,
  onCopy,
}: {
  rawToken: string | null;
  onClose: () => void;
  onCopy: () => void;
}) {
  return (
    <Dialog
      open={rawToken !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-[420px] border-sap-border bg-sap-surface p-5 text-sap-fg">
        <DialogHeader className="pr-6">
          <div className="flex items-start gap-3 text-left">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] bg-sap-active-nav text-sap-brand">
              <KeyRound className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[16px] font-[680]">
                New access token created
              </DialogTitle>
              <DialogDescription className="mt-2 text-sap-body text-sap-muted">
                Copy this token now. It will not be shown again after this
                popup is closed.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_36px]">
          <Input
            aria-label="New agent access token"
            className="min-w-0 border-sap-border bg-sap-surface font-mono text-[12px] text-sap-fg"
            value={rawToken ?? ""}
            readOnly
          />
          <button
            className="flex h-9 w-9 items-center justify-center rounded-[7px] border border-sap-border bg-sap-surface text-sap-muted hover:text-sap-fg"
            type="button"
            title="Copy token"
            onClick={onCopy}
          >
            <Copy className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className="border-sap-border bg-sap-surface text-sap-muted hover:text-sap-fg"
            >
              Close
            </Button>
          </DialogClose>
          <Button
            type="button"
            className="bg-sap-brand text-white hover:bg-sap-brand/90"
            onClick={onCopy}
          >
            <Copy className="h-4 w-4" strokeWidth={1.8} />
            Copy token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
