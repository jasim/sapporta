import { Route, Navigate, useLocation } from "react-router-dom";
import { SidebarSectionLabel, SidebarNavItem } from "@sapporta/frontend/shell";
import { Sparkles } from "lucide-react";
import { Welcome } from "./Welcome";

const welcomePath = "/welcome";

// Add each domain screen here with its sidebar link and route.
export function AppSidebar() {
  const { pathname } = useLocation();
  return (
    <>
      <SidebarSectionLabel>Views</SidebarSectionLabel>
      <SidebarNavItem
        to={welcomePath}
        label="Welcome"
        icon={<Sparkles className="h-[12px] w-[12px]" strokeWidth={1.5} />}
        active={pathname.startsWith(welcomePath)}
      />
    </>
  );
}

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
