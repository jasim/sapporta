import { lazy, Suspense } from "react";
import { Route, Navigate } from "react-router-dom";
import type { Navigation } from "@sapporta/frontend/shell";
import { Sparkles } from "lucide-react";

const welcomePath = "/welcome";

const PublicPage = lazy(() =>
  import("./PublicPage").then((m) => ({ default: m.PublicPage })),
);

const Welcome = lazy(() =>
  import("./Welcome").then((m) => ({ default: m.Welcome })),
);

function RouteFallback() {
  return (
    <div className="p-[18px] text-sap-data text-sap-muted">Loading...</div>
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

    {/* Add protected app routes here, e.g.:
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
