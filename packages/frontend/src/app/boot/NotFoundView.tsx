import { AppPage } from "../../shell/components/Page";

export function NotFoundView() {
  return (
    <AppPage
      title="Page not found"
      bodyClassName="flex items-center justify-center text-sap-muted"
    >
      We could not find that page.
    </AppPage>
  );
}
