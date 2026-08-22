import { lazy, Suspense, type ReactElement } from "react";
import { Route } from "react-router-dom";
import type { Navigation } from "@sapporta/frontend/shell";
import { AppPage } from "@sapporta/frontend/layout";
import { House } from "lucide-react";

/**
 * Add the application's routes and navigation here. `SapportaApp.tsx` combines
 * them with Sapporta's account and table routes. Table links are added from the
 * loaded schema.
 */
const homePath = "/";

const PublicPage = lazy(() =>
  import("./PublicPage").then((m) => ({ default: m.PublicPage })),
);

const Home = lazy(() => import("./Home").then((m) => ({ default: m.Home })));

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
        label: "Home",
        icon: House,
        to: homePath,
      },
    ],
  },
];

// The screen at `/`. It opens for signed-in users, and it is where they arrive
// after signing in. Replace `Home` with the screen your app should open on.
export const appHomeRoute = (
  <Route
    index
    element={
      <Suspense fallback={<RouteFallback />}>
        <Home />
      </Suspense>
    }
  />
);

// Set this to an index route when anyone should be able to read `/`, such as a
// landing page for visitors who have not signed in. It then opens `/` in place
// of `appHomeRoute`, so give the signed-in home screen a path of its own in
// `appProtectedRoutes` when the app needs both.
export const appPublicHomeRoute: ReactElement | null = null;

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
