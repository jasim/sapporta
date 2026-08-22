import { describe, expect, it } from "vitest";
import type { Location } from "react-router-dom";
import { isNavigationItemActive, type NavigationItem } from "./navigation";

function locationAt(pathname: string): Location {
  return { pathname, search: "", hash: "", state: null, key: "test" };
}

const home: NavigationItem = { label: "Home", to: "/" };
const orders: NavigationItem = { label: "Orders", to: "/orders" };

describe("isNavigationItemActive", () => {
  it("marks the home item active only on the home page", () => {
    expect(isNavigationItemActive(home, locationAt("/"))).toBe(true);
    expect(isNavigationItemActive(home, locationAt("/orders"))).toBe(false);
  });

  it("marks an item active on its own page and the pages under it", () => {
    expect(isNavigationItemActive(orders, locationAt("/orders"))).toBe(true);
    expect(isNavigationItemActive(orders, locationAt("/orders/"))).toBe(true);
    expect(isNavigationItemActive(orders, locationAt("/orders/42"))).toBe(true);
  });

  it("does not follow a neighbouring page with a longer name", () => {
    expect(isNavigationItemActive(orders, locationAt("/orders-archive"))).toBe(
      false,
    );
  });
});
