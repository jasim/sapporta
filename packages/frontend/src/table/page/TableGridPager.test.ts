// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  focusTableGridPagerBoundary,
  type TableGridPagerButtonRefs,
} from "./TableGridPager";

function buttonRefs({
  previous,
  next,
}: {
  previous?: HTMLButtonElement;
  next?: HTMLButtonElement;
}): TableGridPagerButtonRefs {
  return {
    previous: { current: previous ?? null },
    next: { current: next ?? null },
  };
}

describe("focusTableGridPagerBoundary", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("focuses the enabled button for the visible boundary direction", () => {
    const previous = document.createElement("button");
    const next = document.createElement("button");
    document.body.append(previous, next);
    const refs = buttonRefs({ previous, next });

    expect(focusTableGridPagerBoundary("after", refs)).toBe(true);
    expect(document.activeElement).toBe(next);

    expect(focusTableGridPagerBoundary("before", refs)).toBe(true);
    expect(document.activeElement).toBe(previous);
  });

  it("declines missing and disabled pagination destinations", () => {
    const next = document.createElement("button");
    next.disabled = true;
    document.body.append(next);
    const refs = buttonRefs({ next });

    expect(focusTableGridPagerBoundary("after", refs)).toBe(false);
    expect(focusTableGridPagerBoundary("before", refs)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });
});
