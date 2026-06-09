import { Route, Navigate } from "react-router-dom";
import type { Navigation } from "@sapporta/frontend/shell";
import { Sparkles } from "lucide-react";
import { Welcome } from "./Welcome";

const welcomePath = "/welcome";

// Add each domain screen here with its navigation item and route.
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

export const appRoutes = (
  <>
    <Route path="welcome" element={<Welcome />} />

    {/* Add app routes here, e.g.:
        <Route path="views/imports" element={<Imports />} /> */}
  </>
);
