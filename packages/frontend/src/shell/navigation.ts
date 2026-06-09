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

export function isNavigationItemActive(
  item: NavigationItem,
  location: Location,
): boolean {
  return location.pathname.startsWith(item.to);
}
