import { useLocation } from "react-router-dom";
import { SidebarSectionLabel, SidebarNavItem } from "@sapporta/frontend";
import { Sparkles } from "lucide-react";

// Custom sidebar entries. Rendered ABOVE the library's Tables/Reports
// sections. Use `SidebarSectionLabel` + `SidebarNavItem` so rows match the
// built-in ones. Icons must be 12px with `strokeWidth={1.5}`.
export function Sidebar() {
  const { pathname } = useLocation();
  return (
    <>
      <SidebarSectionLabel>Views</SidebarSectionLabel>
      <SidebarNavItem
        to="/welcome"
        label="Welcome"
        icon={<Sparkles className="h-[12px] w-[12px]" strokeWidth={1.5} />}
        active={pathname.startsWith("/welcome")}
      />
    </>
  );
}
