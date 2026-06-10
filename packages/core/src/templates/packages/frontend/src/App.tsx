import { Route, Navigate } from "react-router-dom";
import type { Navigation } from "@sapporta/frontend/shell";
import { Sparkles } from "lucide-react";
import { PublicPage } from "./PublicPage";
import { Welcome } from "./Welcome";

const welcomePath = "/welcome";

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
    <Route path="public" element={<PublicPage />} />
  </>
);

// Routes here render inside the authenticated app shell.
export const appProtectedRoutes = (
  <>
    <Route path="welcome" element={<Welcome />} />

    {/* Add protected app routes here, e.g.:
        <Route path="views/imports" element={<Imports />} /> */}
  </>
);
