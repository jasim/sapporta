import { describe, expect, it } from "vitest";
import { parseTimeZone } from "@sapporta/shared/temporal";
import { createTestAuthContext } from "../testing/auth-context.js";
import { createAuthContext } from "./create-auth-context.js";
import { createTableCatalog } from "../schema/catalog.js";
import { anonymousPrincipal } from "./principal.js";
import {
  requestDataAuthority,
  systemGlobalOnlyAuthority,
  workspaceGlobalOnlyAuthority,
} from "./request-data-authority.js";
import { workspaceTimeZone } from "./context.js";

describe("the calendar a request works in", () => {
  it("is the active workspace's, whichever authority carries it", () => {
    expect(
      workspaceTimeZone(createTestAuthContext({ timeZone: "Asia/Kolkata" })),
    ).toBe("Asia/Kolkata");

    const workspaceOnly = createAuthContext({
      principal: anonymousPrincipal(),
      dataAuthority: requestDataAuthority({
        workspaceGlobalOnly: workspaceGlobalOnlyAuthority({
          id: "workspace-1",
          name: "Acme",
          slug: "acme",
          timeZone: parseTimeZone("America/New_York"),
        }),
      }),
      ability: { can: () => true },
      catalog: createTableCatalog([]),
    });
    expect(workspaceTimeZone(workspaceOnly)).toBe("America/New_York");
  });

  /**
   * A request with no workspace has no calendar, and answering `UTC` would be
   * silently wrong for every workspace that does not keep it.
   */
  it("refuses a request that has no workspace", () => {
    const systemOnly = createAuthContext({
      principal: anonymousPrincipal(),
      dataAuthority: requestDataAuthority({
        systemGlobalOnly: systemGlobalOnlyAuthority(),
      }),
      ability: { can: () => true },
      catalog: createTableCatalog([]),
    });

    expect(() => workspaceTimeZone(systemOnly)).toThrow(
      /has no workspace, so it has no calendar/,
    );
  });
});
