import { AppPage } from "@sapporta/frontend/layout";
import { buttonVariants } from "@sapporta/ui/button";
import { cn } from "@sapporta/ui/cn";
import { ExternalLink } from "lucide-react";

const gettingStartedUrl = "%%SAPPORTA:DOCS_BROWSER_URL%%";

// The screen at `/`. Replace it with the first dashboard, workflow, or form
// your app should open on.
export function Home() {
  return (
    <AppPage title="Home" bodyClassName="bg-sap-bg text-sap-fg">
      <div className="mx-auto max-w-[32rem] px-6 py-14 sm:py-20">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-4 rounded-[5px] bg-[linear-gradient(135deg,var(--sap-fg)_0_58%,var(--sap-brand)_58%_100%)]"
          />
          <span className="text-sap-data font-[680] text-sap-soft">
            Sapporta
          </span>
        </div>

        <h1 className="mt-6 text-[22px] font-[680] leading-tight text-sap-soft sm:text-[26px]">
          Your app is live
        </h1>
        <p className="mt-3 text-[15px] leading-6 text-sap-muted">
          The database, the API, and this React frontend are all running
          together. Tell a coding agent working in this project what you want to
          build, and it will add the tables, screens, and reports for you.
        </p>

        <div className="mt-7">
          <a
            className={cn(buttonVariants(), "no-underline")}
            href={gettingStartedUrl}
            rel="noreferrer"
            target="_blank"
          >
            Read the getting started guide
            <ExternalLink data-icon="inline-end" strokeWidth={1.8} />
          </a>
        </div>
      </div>
    </AppPage>
  );
}
