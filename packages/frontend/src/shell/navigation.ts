import type { ComponentType } from "react";
import type { Location } from "react-router-dom";

export type NavigationIcon = ComponentType<{
  className?: string;
  strokeWidth?: number | string;
}>;

export interface NavigationItem {
  label: string;
  to: string;
  icon?: NavigationIcon;
}

export interface NavigationSection {
  label: string;
  items: readonly NavigationItem[];
}

export type Navigation = readonly NavigationSection[];

export function navigationItems(navigation: Navigation): NavigationItem[] {
  return navigation.flatMap((section) => section.items);
}

/**
 * Marks a navigation item active on its own page and on the pages nested under
 * it. A home item at `/` stays active only on the home page, and `/orders` does
 * not follow `/orders-archive`.
 */
export function isNavigationItemActive(
  item: NavigationItem,
  location: Location,
): boolean {
  const target = withoutTrailingSlash(item.to);
  const current = withoutTrailingSlash(location.pathname);
  if (target === "") return current === "";
  return current === target || current.startsWith(`${target}/`);
}

function withoutTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}
