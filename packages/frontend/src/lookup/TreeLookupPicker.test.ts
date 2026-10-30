// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupTreeEntry, TableSchema } from "@sapporta/shared/contracts";
import { ApiError } from "@sapporta/shared/error";
import type { LookupValue } from "@sapporta/grid/lookup";
import { LookupPicker, type LookupPickerLabels } from "./LookupPicker";
import { createLookupStore } from "./row-data";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  fetchLookup: vi.fn(),
  fetchLookupSearch: vi.fn(),
  fetchLookupTree: vi.fn(),
}));

vi.mock("./api/lookup", () => api);

const accounts: TableSchema = {
  name: "accounts",
  label: "Accounts",
  immutable: false,
  columns: [],
  children: [],
  rowLabelColumns: ["name"],
  searchable: true,
  tree: {
    parentColumn: "parent_id",
    column: "name",
    defaultExpanded: true,
    matchContext: "ancestors",
    path: "parentPath",
    pathSeparator: " > ",
  },
  computed: [{ name: "parentPath", label: "Parent path", kind: "text" }],
  rowCaption: "parentPath",
};

type Row = { id: number; name: string; path: string | null };
const rows: Record<string, Row> = {
  assets: { id: 1, name: "Assets", path: null },
  bank: { id: 2, name: "Bank Accounts", path: "Assets" },
  savings: { id: 3, name: "Savings", path: "Assets > Bank Accounts" },
  checking: { id: 4, name: "Checking", path: "Assets > Bank Accounts" },
  cash: { id: 5, name: "Cash", path: "Assets" },
};

function treeEntry(
  row: Row,
  depth: number,
  role: LookupTreeEntry["role"] = "choice",
): LookupTreeEntry {
  return { value: row.id, label: row.name, meta: {}, depth, role };
}

function pathsOf(list: readonly Row[]) {
  return {
    parentPath: Object.fromEntries(list.map((row) => [row.id, row.path])),
  };
}

let mounted: { root: Root; container: HTMLElement } | null = null;

async function renderPicker(args: {
  value: number | null;
  onChange?: (value: LookupValue | null) => void;
  tree?: boolean;
  labels?: LookupPickerLabels;
}): Promise<void> {
  const store = createLookupStore({ tables: () => [accounts] });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(
      createElement(LookupPicker, {
        lookup: store.table("accounts"),
        value: args.value,
        onChange: args.onChange ?? (() => undefined),
        placeholder: "Pick a parent",
        ...(args.tree === undefined ? {} : { tree: args.tree }),
        ...(args.labels === undefined ? {} : { labels: args.labels }),
      }),
    );
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (err: unknown) {
      lastError = err;
      await settle();
    }
  }
  throw lastError;
}

function input(): HTMLInputElement {
  const element = document.querySelector('input[role="combobox"]');
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Could not find combobox input.");
  }
  return element;
}

async function pressKey(key: string): Promise<void> {
  await act(async () => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

async function type(value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input(), value);
    input().dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: value.at(-1) ?? null,
        inputType: "insertText",
      }),
    );
  });
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`No button named ${label}.`);
  return button;
}

function options(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
}

// Each option as one line: its indent in steps, its text, and "[off]" when
// it cannot be picked.
function drawn(): string[] {
  return options().map((option) => {
    const pad = option.style.paddingInlineStart;
    const depth = pad ? Math.round((parseFloat(pad) - 0.5) / 1.125) : 0;
    const off = option.hasAttribute("data-disabled") ? " [off]" : "";
    return `${"  ".repeat(depth)}${option.textContent ?? ""}${off}`;
  });
}

function highlighted(): string | undefined {
  return (
    options().find((option) => option.hasAttribute("data-highlighted"))
      ?.textContent ?? undefined
  );
}

beforeEach(() => {
  api.fetchLookup.mockImplementation(
    async (_table: string, ids: readonly (string | number)[]) => {
      const found = Object.values(rows).filter((row) =>
        ids.map(String).includes(String(row.id)),
      );
      return {
        entries: found.map((row) => ({
          value: row.id,
          label: row.name,
          meta: {},
        })),
        computed: pathsOf(found),
      };
    },
  );
  api.fetchLookupSearch.mockResolvedValue({ entries: [] });
});

afterEach(async () => {
  if (mounted) {
    await act(async () => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("LookupPicker on a tree table", () => {
  it("draws the server's tree, greying the ancestors that cannot be picked", async () => {
    // The narrowing lets only the bank accounts through; Assets and Bank
    // Accounts place them, and Cash, with nothing pickable, is not sent.
    api.fetchLookupTree.mockResolvedValue({
      entries: [
        treeEntry(rows.assets!, 0, "context"),
        treeEntry(rows.bank!, 1, "context"),
        treeEntry(rows.savings!, 2),
        treeEntry(rows.checking!, 2),
      ],
    });
    await renderPicker({ value: null });
    await pressKey("ArrowDown");

    await waitFor(() =>
      expect(drawn()).toEqual([
        "Assets [off]",
        "  Bank Accounts [off]",
        "    Savings",
        "    Checking",
      ]),
    );
    expect(api.fetchLookupTree).toHaveBeenCalledWith(
      "accounts",
      ["parentPath"],
      undefined,
    );
  });

  it("marks the row being edited, which cannot be picked", async () => {
    api.fetchLookupTree.mockResolvedValue({
      entries: [
        treeEntry(rows.assets!, 0),
        treeEntry(rows.bank!, 1, "editing"),
        treeEntry(rows.cash!, 1),
      ],
    });
    await renderPicker({ value: null });
    await pressKey("ArrowDown");

    await waitFor(() =>
      expect(drawn()).toEqual([
        "Assets",
        "  Bank Accounts (being edited) [off]",
        "  Cash",
      ]),
    );
  });

  it("moves across depths with the keyboard, skipping rows that cannot be picked", async () => {
    api.fetchLookupTree.mockResolvedValue({
      entries: [
        treeEntry(rows.assets!, 0, "context"),
        treeEntry(rows.bank!, 1, "context"),
        treeEntry(rows.savings!, 2),
        treeEntry(rows.cash!, 1),
      ],
    });
    const onChange = vi.fn();
    await renderPicker({ value: null, onChange });
    await pressKey("ArrowDown");
    await waitFor(() => expect(options()).toHaveLength(4));

    // Opening highlights the first row that can be picked.
    expect(highlighted()).toBe("Savings");
    await pressKey("ArrowDown");
    expect(highlighted()).toBe("Cash");
    await pressKey("ArrowUp");
    expect(highlighted()).toBe("Savings");
    await pressKey("Enter");
    expect(onChange).toHaveBeenCalledWith(rows.savings!.id);
  });

  it("searches on the server and lists the matches flat, with their paths", async () => {
    api.fetchLookupTree.mockResolvedValue({
      entries: [treeEntry(rows.assets!, 0)],
    });
    api.fetchLookupSearch.mockImplementation(async (_table, searchText) =>
      searchText === "ing"
        ? {
            entries: [
              { value: rows.savings!.id, label: "Savings", meta: {} },
              { value: rows.checking!.id, label: "Checking", meta: {} },
            ],
            computed: pathsOf([rows.savings!, rows.checking!]),
          }
        : { entries: [] },
    );
    await renderPicker({ value: null });
    await type("ing");

    await waitFor(() =>
      expect(drawn()).toEqual([
        "Assets > Bank Accounts > Savings",
        "Assets > Bank Accounts > Checking",
      ]),
    );
    expect(input().value).toBe("ing");
  });

  it("shows the chosen row's parent path before its name, inside the field", async () => {
    api.fetchLookupTree.mockResolvedValue({ entries: [] });
    await renderPicker({ value: rows.savings!.id });

    await waitFor(() => expect(input().value).toBe("Savings"));
    const path = document.querySelector("[data-lookup-selected-path]");
    expect(path?.textContent).toBe("Assets > Bank Accounts > ");
    // Inside the field, before the input.
    expect(path?.nextElementSibling).toBe(input());
    expect(document.querySelector("[data-lookup-selected-caption]")).toBe(null);
  });

  it("keeps what is typed while the tree is read again", async () => {
    let finish: (value: { entries: LookupTreeEntry[] }) => void = () =>
      undefined;
    api.fetchLookupTree.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await renderPicker({ value: null });
    await type("sav");
    await act(async () => {
      finish({ entries: [treeEntry(rows.assets!, 0)] });
    });
    await settle();
    expect(input().value).toBe("sav");
  });

  it("says so when the tree is too large to draw", async () => {
    api.fetchLookupTree.mockRejectedValue(
      new ApiError(400, { error: "too large", code: "TREE_TOO_LARGE" }),
    );
    await renderPicker({ value: null });
    await pressKey("ArrowDown");

    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "Too many rows to show here. Type to search.",
      ),
    );
  });

  it("says what the application's labels say", async () => {
    api.fetchLookupTree.mockResolvedValue({
      entries: [
        treeEntry(rows.assets!, 0),
        treeEntry(rows.bank!, 1, "editing"),
      ],
    });
    await renderPicker({
      value: rows.assets!.id,
      labels: {
        clear: "Make it a top-level account",
        open: "Show the accounts",
        editing: "(this account)",
      },
    });
    await act(async () => buttonByLabel("Show the accounts").click());

    await waitFor(() =>
      expect(drawn()).toEqual([
        "Assets",
        "  Bank Accounts (this account) [off]",
      ]),
    );
    expect(buttonByLabel("Make it a top-level account")).toBeDefined();
  });

  it("says the application's words when nothing matches or the tree fails", async () => {
    api.fetchLookupTree.mockRejectedValue(new Error("offline"));
    await renderPicker({
      value: null,
      labels: {
        empty: "No account matches.",
        loadFailed: "Could not read the chart.",
      },
    });
    await pressKey("ArrowDown");
    await waitFor(() =>
      expect(document.body.textContent).toContain("Could not read the chart."),
    );

    await type("zzz");
    await waitFor(() =>
      expect(document.body.textContent).toContain("No account matches."),
    );
  });

  it("draws the flat list with tree={false}", async () => {
    api.fetchLookupSearch.mockResolvedValue({
      entries: [{ value: rows.cash!.id, label: "Cash", meta: {} }],
    });
    await renderPicker({ value: null, tree: false });
    await pressKey("ArrowDown");

    await waitFor(() => expect(drawn()).toEqual(["CashAssets"]));
    expect(api.fetchLookupTree).not.toHaveBeenCalled();
  });
});
