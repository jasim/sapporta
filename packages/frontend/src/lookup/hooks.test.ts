// @vitest-environment happy-dom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LookupCapabilities } from "@sapporta/grid/lookup";
import type { LookupValue } from "@sapporta/grid/lookup";
import { useTableLookup } from "./index";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { fetchLookupEntriesForSearchSpy } = vi.hoisted(() => ({
  fetchLookupEntriesForSearchSpy: vi.fn(),
}));

vi.mock("./api/lookup", () => ({
  fetchLookupEntriesForSearch: fetchLookupEntriesForSearchSpy,
  fetchLookupEntriesForValues: vi.fn(async () => []),
}));

let mounted: { root: Root; container: HTMLElement } | null = null;

async function render(element: React.ReactElement): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted = { root, container };

  await act(async () => {
    root.render(element);
  });
}

describe("lookup hooks", () => {
  afterEach(async () => {
    if (mounted) {
      await act(async () => {
        mounted?.root.unmount();
      });
      mounted.container.remove();
      mounted = null;
    }
    fetchLookupEntriesForSearchSpy.mockReset();
  });

  it("creates a new lookup source when the table changes", async () => {
    const seen: LookupCapabilities[] = [];

    function Probe({ tableName }: { tableName: string }) {
      const lookup = useTableLookup(tableName);
      seen.push(lookup);
      return null;
    }

    await render(createElement(Probe, { tableName: "customers" }));
    const first = seen[0];

    await render(createElement(Probe, { tableName: "accounts" }));

    expect(seen[1]).not.toBe(first);
  });

  it("stays usable after StrictMode unmounts and remounts the same memoized source", async () => {
    fetchLookupEntriesForSearchSpy.mockResolvedValue({
      entries: [{ value: 1, label: "Customer 1" }],
    });
    let seen: LookupCapabilities | undefined;

    function Probe() {
      seen = useTableLookup("customers");
      return null;
    }

    // StrictMode mounts, runs cleanup, then mounts again while preserving the
    // memoized lookup. The source must remain usable after the replay.
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted = { root, container };

    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Probe)));
    });

    expect(seen).toBeDefined();
    await act(async () => {
      await seen!.searchLookup!.loadSearchResults({
        searchText: "cus",
        limit: 10,
      });
    });

    expect(fetchLookupEntriesForSearchSpy).toHaveBeenCalledWith({
      tableName: "customers",
      searchText: "cus",
      limit: 10,
    });
    expect(
      (
        seen!.searchLookup!.cachedSearchResults({
          searchText: "cus",
        }) as readonly {
          value: LookupValue;
          label: string;
        }[]
      ).map((entry) => entry.label),
    ).toEqual(["Customer 1"]);
  });
});
