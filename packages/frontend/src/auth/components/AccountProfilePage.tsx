import {
  Building2,
  CheckCircle2,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
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
      </div>
    </div>
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
      <span className="min-w-0 truncate text-sap-body text-sap-fg">{value}</span>
    </div>
  );
}
