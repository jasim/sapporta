/**
 * PUBLIC PAGE SAMPLE
 *
 * This route is mounted through `appPublicRoutes`, outside `AuthGate`, so
 * anyone can load it. Keep public pages and their API calls limited to data the
 * application explicitly intends to expose.
 */
import { useEffect, useState } from "react";
import { AppPage } from "@sapporta/frontend/layout";

type PublicSampleState =
  | { kind: "loading" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

export function PublicPage() {
  const [sample, setSample] = useState<PublicSampleState>({
    kind: "loading",
  });

  useEffect(() => {
    import("./api")
      .then(({ publicApi }) => publicApi.publicApiSample())
      .then(
        (body) => setSample({ kind: "ok", message: body.message }),
        (err: unknown) =>
          setSample({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          }),
      );
  }, []);

  return (
    <AppPage
      title="Public page"
      bodyClassName="bg-sap-surface px-8 py-10 text-sap-fg"
    >
      <div className="mx-auto max-w-[560px] space-y-4">
        <p className="text-sap-body text-sap-muted">
          This page is available without signing in.
        </p>
        <div className="rounded-md border border-sap-border bg-sap-sidebar px-4 py-3 text-sap-data">
          {sample.kind === "loading"
            ? "Loading..."
            : sample.kind === "ok"
              ? sample.message
              : sample.message}
        </div>
      </div>
    </AppPage>
  );
}
