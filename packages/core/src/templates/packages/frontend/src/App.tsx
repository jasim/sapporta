import { lazy, Suspense } from "react";
import { Route, Navigate } from "react-router-dom";
import type { Navigation } from "@sapporta/frontend/shell";
import { AppPage } from "@sapporta/frontend/layout";
import { Sparkles } from "lucide-react";

/**
 * Add the application's routes and navigation here. `SapportaApp.tsx` combines
 * them with Sapporta's account and table routes. Table links are added from the
 * loaded schema.
 */
const welcomePath = "/welcome";

const PublicPage = lazy(() =>
  import("./PublicPage").then((m) => ({ default: m.PublicPage })),
);

const Welcome = lazy(() =>
  import("./Welcome").then((m) => ({ default: m.Welcome })),
);

function RouteFallback() {
  return (
    <AppPage
      title="Loading"
      bodyClassName="p-[18px] text-sap-data text-sap-muted"
    >
      Loading...
    </AppPage>
  );
}

// Add protected domain screens here with their navigation items.
export const appNavigation: Navigation = [
  {
    label: "Views",
    items: [
      {
        label: "Welcome",
        icon: Sparkles,
        to: welcomePath,
      },
    ],
  },
];

// Change this when you want `/` to open a different screen.
export const appHomeRoute = (
  <Route index element={<Navigate to={welcomePath} replace />} />
);

// Routes here render without requiring a signed-in session.
export const appPublicRoutes = (
  <>
    {/* PUBLIC: anyone can load this page. Keep its data intentionally public. */}
    <Route
      path="public"
      element={
        <Suspense fallback={<RouteFallback />}>
          <PublicPage />
        </Suspense>
      }
    />
  </>
);

// Routes here render inside the authenticated app shell.
export const appProtectedRoutes = (
  <>
    <Route
      path="welcome"
      element={
        <Suspense fallback={<RouteFallback />}>
          <Welcome />
        </Suspense>
      }
    />

    {/* Standard screens can use `AppPage` for the usual fixed header and
        scrolling content area. Its `title` also names the browser tab. Other
        screens can choose their own height and scrolling behavior; `AppShell`
        keeps its sidebar control available, and `usePageTitle` from
        `@sapporta/frontend/shell` names the tab for screens without the
        standard header.

        Add protected app routes here, e.g.:
        <Route
          path="views/imports"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Imports />
            </Suspense>
          }
        /> */}
  </>
);
