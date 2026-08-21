// @vitest-environment happy-dom

import { StrictMode, act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCommittedDisposableResource } from "./use-committed-disposable-resource";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type TestResource = {
  key: string;
  id: number;
  dispose(): void;
};

describe("useCommittedDisposableResource", () => {
  let mounted: { root: Root; container: HTMLElement } | null = null;

  afterEach(async () => {
    if (!mounted) return;
    await act(async () => {
      mounted?.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  });

  async function renderClient(element: ReactElement): Promise<{
    root: Root;
    container: HTMLElement;
  }> {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(element);
    });
    mounted = { root, container };
    return { root, container };
  }

  function makeProbe(options?: { strict?: boolean }) {
    let nextId = 0;
    const dispose = vi.fn<(resource: TestResource) => void>();
    const renders: string[] = [];

    function Probe({ resourceKey }: { resourceKey: string }) {
      const resource = useCommittedDisposableResource(
        () => {
          nextId += 1;
          const resource: TestResource = {
            key: resourceKey,
            id: nextId,
            dispose: () => dispose(resource),
          };
          return resource;
        },
        [resourceKey],
      );

      renders.push(
        resource
          ? `resource:${resource.key}:${resource.id}`
          : `null:${resourceKey}`,
      );

      return createElement(
        "div",
        null,
        resource ? `${resource.key}:${resource.id}` : "loading",
      );
    }

    function render(resourceKey: string): ReactElement {
      const element = createElement(Probe, { resourceKey });
      return options?.strict
        ? createElement(StrictMode, null, element)
        : element;
    }

    return { dispose, renders, render };
  }

  it("hides a stored resource whose key no longer matches the current render", async () => {
    const probe = makeProbe();
    const { root, container } = await renderClient(probe.render("a"));

    expect(container.textContent).toBe("a:1");

    await act(async () => {
      root.render(probe.render("b"));
    });

    expect(probe.renders).toContain("null:b");
    expect(container.textContent).toBe("b:2");
    expect(probe.dispose).toHaveBeenCalledTimes(1);
    expect(probe.dispose).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ key: "a", id: 1 }),
    );

    await act(async () => {
      root.unmount();
    });
    mounted?.container.remove();
    mounted = null;

    expect(probe.dispose).toHaveBeenCalledTimes(2);
    expect(probe.dispose).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ key: "b", id: 2 }),
    );
  });

  it("keeps the same key proof under StrictMode effect replay", async () => {
    const probe = makeProbe({ strict: true });
    const { root, container } = await renderClient(probe.render("a"));

    expect(container.textContent).toMatch(/^a:/);

    await act(async () => {
      root.render(probe.render("b"));
    });

    expect(probe.renders).toContain("null:b");
    expect(container.textContent).toMatch(/^b:/);
    expect(
      probe.dispose.mock.calls.filter(([resource]) => resource.key === "a"),
    ).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
    mounted?.container.remove();
    mounted = null;

    const disposedIds = probe.dispose.mock.calls.map(
      ([resource]) => resource.id,
    );
    expect(new Set(disposedIds).size).toBe(disposedIds.length);
  });
});
