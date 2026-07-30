import { describe, expect, it } from "vitest";
import * as layout from "../layout";
import * as shell from "../shell";

describe("@sapporta/frontend shell public surface", () => {
  it("exports the composable page and sidebar primitives from layout and shell", () => {
    for (const publicSurface of [layout, shell]) {
      expect(publicSurface).toHaveProperty("AppPage");
      expect(publicSurface).toHaveProperty("PageFrame");
      expect(publicSurface).toHaveProperty("PageHeader");
      expect(publicSurface).toHaveProperty("PageHeaderButton");
      expect(publicSurface).toHaveProperty("PageBody");
      expect(publicSurface).toHaveProperty("SidebarProvider");
      expect(publicSurface).toHaveProperty("SidebarRegion");
      expect(publicSurface).toHaveProperty("SidebarShell");
      expect(publicSurface).toHaveProperty("SidebarToggle");
      expect(publicSurface).toHaveProperty("useSidebar");
      expect(publicSurface).not.toHaveProperty("TopBar");
      expect(publicSurface).not.toHaveProperty("TopBarButton");
    }
  });
});
