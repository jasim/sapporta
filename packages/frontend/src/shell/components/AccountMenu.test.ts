// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AuthContextResponse } from "@sapporta/shared/contracts";
import { AccountMenu } from "./AccountMenu";
import {
  formatAuthRole,
  getAccountDisplayName,
  getAccountInitials,
  getAccountSecondaryLabel,
} from "./AccountMenu";

const AUTH_CONTEXT = {
  user: {
    id: "user-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    emailVerified: true,
  },
  workspace: {
    id: "workspace-1",
    name: "Analytical Engines",
    slug: "analytical-engines",
    isOwner: true,
  },
  memberships: [
    {
      id: "member-1",
      workspace: {
        id: "workspace-1",
        name: "Analytical Engines",
        slug: "analytical-engines",
      },
      role: "owner",
      isOwner: true,
    },
  ],
  role: "owner",
  isOwner: true,
} satisfies AuthContextResponse;

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  document.body.innerHTML = "";
});

describe("account menu helpers", () => {
  it("uses the user's name as the primary display label", () => {
    expect(getAccountDisplayName(AUTH_CONTEXT.user)).toBe("Ada Lovelace");
    expect(getAccountInitials(AUTH_CONTEXT.user)).toBe("AL");
  });

  it("falls back to email when name is missing", () => {
    const user = {
      ...AUTH_CONTEXT.user,
      name: null,
      email: "owner@example.com",
    };

    expect(getAccountDisplayName(user)).toBe("owner@example.com");
    expect(getAccountInitials(user)).toBe("OE");
  });

  it("summarizes active workspace and role", () => {
    expect(getAccountSecondaryLabel(AUTH_CONTEXT)).toBe(
      "Analytical Engines - Owner",
    );
    expect(formatAuthRole("member")).toBe("Member");
  });
});

describe("account menu trigger", () => {
  it("opens the default account menu trigger", async () => {
    await act(async () => {
      root.render(
        createElement(AccountMenu, {
          context: AUTH_CONTEXT,
          onLogout: vi.fn(),
        }),
      );
    });

    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Open account menu for Ada Lovelace"]',
    );
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Log out");
  });

  it("shows a pending label while an action is running", async () => {
    let finishAction: () => void = () => {};
    await act(async () => {
      root.render(
        createElement(AccountMenu, {
          context: AUTH_CONTEXT,
          sections: [
            {
              id: "profile",
              actions: [
                {
                  id: "save",
                  label: "Save",
                  pendingLabel: "Saving...",
                  onSelect: () =>
                    new Promise<void>((resolve) => {
                      finishAction = resolve;
                    }),
                },
              ],
            },
          ],
        }),
      );
    });

    await openMenu();
    await clickButton("Save");

    expect(document.body.textContent).toContain("Saving...");

    await act(async () => {
      finishAction();
    });
  });

  it("keeps the menu open and reports action failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      root.render(
        createElement(AccountMenu, {
          context: AUTH_CONTEXT,
          sections: [
            {
              id: "profile",
              actions: [
                {
                  id: "save",
                  label: "Save",
                  onSelect: () => {
                    throw new Error("Could not save profile.");
                  },
                },
              ],
            },
          ],
        }),
      );
    });

    await openMenu();
    await clickButton("Save");

    expect(document.body.textContent).toContain("Could not save profile.");
    expect(document.body.textContent).toContain("Save");
    consoleError.mockRestore();
  });
});

async function openMenu() {
  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Open account menu for Ada Lovelace"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function clickButton(label: string) {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  expect(button).not.toBeUndefined();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
