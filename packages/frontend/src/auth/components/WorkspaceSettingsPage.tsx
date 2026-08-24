import { ArrowLeft, Building2, Globe } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { buttonVariants } from "@sapporta/ui/button";
import { appTimeZone } from "../../platform/app-time-zone";
import { errorMessage } from "../../platform/http";
import { useAuthStore } from "../state/auth-store";
import { AppPage } from "../../shell/components/Page";
import { WorkspaceTimeZonePicker } from "../../shell/components/WorkspaceTimeZonePicker";

/**
 * The settings that belong to the workspace rather than to whoever is signed
 * in to it.
 *
 * Owner only. Everything here is read by every member, so it is changed by the
 * person who answers for the workspace.
 */
export function WorkspaceSettingsPage() {
  const session = useAuthStore((state) => state.session);

  if (session.kind === "unknown" || session.kind === "loading") {
    return (
      <AppPage
        title="Workspace settings"
        bodyClassName="flex items-center justify-center text-sap-muted"
      >
        Loading...
      </AppPage>
    );
  }

  if (session.kind !== "authenticated") {
    return (
      <AppPage
        title="Workspace settings"
        bodyClassName="flex items-center justify-center text-sap-muted"
      >
        Not signed in.
      </AppPage>
    );
  }

  const { context } = session;

  return (
    <AppPage title="Workspace settings">
      <div className="mx-auto w-full max-w-[760px] px-6 py-8">
        <Link
          className={`${buttonVariants({ variant: "ghost" })} mb-5 -ml-2 gap-2`}
          to="/account/profile"
        >
          <ArrowLeft className="size-4" strokeWidth={1.7} />
          Back to account
        </Link>

        <div className="mb-7 flex items-center gap-3">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[7px] bg-sap-active-nav text-sap-brand">
            <Building2 className="size-5" strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[22px] font-[680] leading-tight text-sap-fg">
              {context.workspace.name}
            </h2>
            <p className="mt-1 truncate text-sap-body text-sap-muted">
              {context.workspace.slug}
            </p>
          </div>
        </div>

        <WorkspaceCalendar canEdit={context.workspace.isOwner} />
      </div>
    </AppPage>
  );
}

function WorkspaceCalendar({ canEdit }: { canEdit: boolean }) {
  const setWorkspaceTimeZone = useAuthStore((s) => s.setWorkspaceTimeZone);
  const [pending, setPending] = useState(false);

  async function choose(zone: string) {
    setPending(true);
    try {
      await setWorkspaceTimeZone({ timeZone: zone });
      toast.success(`This workspace now reads days in ${zone}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-8">
      <header className="mb-3 flex items-center gap-2">
        <Globe className="size-4 text-sap-subtle" strokeWidth={1.7} />
        <h2 className="text-[17px] font-[680] text-sap-fg">Time zone</h2>
      </header>
      <div className="flex min-h-[70px] flex-wrap items-center justify-between gap-4 border-y border-sap-border-soft py-3">
        <div className="min-w-0">
          <p className="max-w-[52ch] text-sap-data text-sap-muted">
            Every date and time in this workspace is shown on this clock, and
            every report groups its days by it. It is the workspace's setting,
            not a preference of your browser, so everyone here reads the same
            day for the same moment.{" "}
            {canEdit
              ? "Changing it changes what a date means for everyone in the workspace."
              : "Only a workspace owner can change it."}
          </p>
        </div>
        <WorkspaceTimeZonePicker
          value={appTimeZone()}
          onSelect={choose}
          disabled={!canEdit || pending}
        />
      </div>
    </section>
  );
}
