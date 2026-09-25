import { type ReactNode, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import { ListFilter } from "lucide-react";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
import { AuthAccountMenu } from "./AuthAccountMenu";
import { SidebarShell } from "./SidebarShell";
import { useSidebar } from "../sidebar-controller";
import {
  isNavigationItemActive,
  navigationItems,
  type Navigation,
  type NavigationItem,
} from "../navigation";

export interface NavigationShellProps {
  navigation: Navigation;
}

export interface AppSidebarProps extends NavigationShellProps {
  /** An optional control shown beside the application identity. */
  sidebarToggle?: ReactNode;
  /**
   * What sits under the navigation. Left out, it is the account menu, which is
   * what an app whose people have accounts to manage wants there.
   *
   * An app that wants something else - a demo nobody signs out of, a build
   * stamp, a support link - passes it here rather than copying this file to
   * change one line. `null` leaves the footer out altogether.
   */
  footer?: ReactNode;
}

export function SapportaMark({ size = 17 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block rounded-[6px] shadow-sm"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        background:
          "linear-gradient(135deg, var(--sap-fg) 0 58%, var(--sap-brand) 58% 100%)",
      }}
    />
  );
}

function SidebarHeader() {
  const name = useSchemaStore((s) => s.name);
  return (
    <>
      <SapportaMark size={24} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sap-body font-[680] tracking-sap-display text-sap-soft">
          {name ?? "Your app"}
        </span>
        <span className="text-sap-micro font-semibold uppercase tracking-sap-label text-sap-subtle">
          Sapporta
        </span>
      </span>
    </>
  );
}

export function NavSection({
  label,
  labelHidden = false,
  children,
}: {
  label: ReactNode;
  /** Keep the label's space but not its text, as the collapsed rail does. */
  labelHidden?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col pt-3 first:pt-0">
      <div
        className={cn(
          "flex h-[26px] items-center justify-between px-2 text-xs font-medium text-sap-nav-section",
          labelHidden && "invisible",
        )}
      >
        <span className="truncate">{label}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/**
 * A navigation link: grey text on the sidebar's tone, a faint wash under the
 * pointer that comes at once rather than fading in, and the current page in
 * darker text on a fainter wash, at the same weight so its label keeps its
 * width. Rows sit edge to edge.
 *
 * How it is drawn:
 * - `row`: icon and label, as in the expanded sidebar.
 * - `icon-row`: the same row with its label hidden from view, as in the
 *   collapsed rail. The icon stays where it is in `row`, so it does not move
 *   when the sidebar opens over the page.
 * - `square`: a 40px icon button named by a tooltip, as in `NavigationRail`.
 */
export type NavItemVariant = "row" | "icon-row" | "square";

export function NavItem({
  item,
  active,
  variant = "row",
}: {
  item: NavigationItem;
  active: boolean;
  variant?: NavItemVariant;
}) {
  const Icon = item.icon;
  const square = variant === "square";

  return (
    <Link
      to={item.to}
      title={square ? item.label : undefined}
      aria-label={square ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center rounded-md text-sm font-medium no-underline transition-[background-color] duration-[20ms] ease-in hover:bg-sap-nav-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        square ? "size-10 justify-center" : "h-sap-ctl gap-2 px-2",
        active ? "bg-sap-nav-selected text-sap-fg" : "text-sap-nav-fg",
      )}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center text-sap-nav-icon",
          square ? "size-5" : "size-6",
        )}
      >
        {Icon ? (
          <Icon className="size-[18px]" strokeWidth={1.5} />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
      </span>
      {!square && (
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            variant === "icon-row" && "sr-only",
          )}
        >
          {item.label}
        </span>
      )}
    </Link>
  );
}

/**
 * Sapporta's standard full navigation. Selecting an item also dismisses the
 * compact drawer, while desktop navigation remains in place.
 *
 * On desktop, `AppShell` passes its sidebar control in for both the expanded
 * sidebar and the collapsed rail. The control comes first in the header, so
 * it stays in the same place on screen whichever way the sidebar is shown.
 * In the rail, the header shows only that control, and each item shows only
 * its icon.
 *
 * Choosing a destination, or an item in the account menu, closes the sidebar
 * that hovering opened, so the page is not left under it.
 */
export function AppSidebar({
  navigation,
  sidebarToggle,
  footer,
}: AppSidebarProps) {
  const location = useLocation();
  const sidebar = useSidebar();

  return (
    <SidebarShell
      rail={sidebar.rail}
      header={
        <>
          {sidebarToggle && (
            <div
              data-shell-sidebar-toggle
              data-sidebar-toggle-location="sidebar"
              className="flex shrink-0"
            >
              {sidebarToggle}
            </div>
          )}
          {!sidebar.rail ? (
            <SidebarHeader />
          ) : (
            !sidebarToggle && (
              <span className="flex size-10 items-center justify-center">
                <SapportaMark size={24} />
              </span>
            )
          )}
        </>
      }
      footer={
        footer === undefined ? (
          <AuthAccountMenu
            compact={sidebar.rail}
            onActionComplete={sidebar.closeTemporary}
          />
        ) : (
          footer
        )
      }
      onNavigate={sidebar.closeTemporary}
    >
      {navigation.map((section) => (
        <NavSection
          key={section.label}
          label={section.label}
          labelHidden={sidebar.rail}
        >
          {section.items.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              active={isNavigationItemActive(item, location)}
              variant={sidebar.rail ? "icon-row" : "row"}
            />
          ))}
        </NavSection>
      ))}
    </SidebarShell>
  );
}

/**
 * Keeps common destinations visible at medium widths. The Browse control
 * still exposes the complete navigation, and the shell control can open the
 * full sidebar as a drawer.
 */
export function NavigationRail({ navigation }: NavigationShellProps) {
  const location = useLocation();
  const allItems = navigationItems(navigation);
  const activeItem = allItems.find((item) =>
    isNavigationItemActive(item, location),
  );
  const items = activeItem
    ? includeActiveRailItem(allItems.slice(0, 8), activeItem)
    : allItems.slice(0, 8);

  return (
    <aside className="hidden h-full w-[68px] shrink-0 flex-col items-center bg-sap-nav py-4 text-sap-fg md:flex">
      <SapportaMark size={22} />
      <nav aria-label="Primary" className="mt-6 flex flex-col gap-1.5">
        {items.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            active={isNavigationItemActive(item, location)}
            variant="square"
          />
        ))}
      </nav>
      <div className="flex-1" />
      <NavigationPicker navigation={navigation} trigger="rail" />
    </aside>
  );
}

/**
 * Keeps a few frequent destinations within thumb reach. Browse exposes every
 * destination, while the shell control remains available for the full drawer.
 */
export function MobileBottomNav({
  navigation,
  pickerNavigation,
}: NavigationShellProps & { pickerNavigation: Navigation }) {
  const location = useLocation();
  const stableItems = navigationItems(navigation).slice(0, 3);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-[var(--sap-z-shell-sticky)] flex h-[56px] items-center justify-around border-t border-sap-border-soft bg-sap-sidebar/95 px-2 shadow-[0_-4px_18px_color-mix(in_oklab,var(--sap-fg)_7%,transparent)] md:hidden"
    >
      {stableItems.map((item) => {
        const active = isNavigationItemActive(item, location);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-12 min-w-[60px] flex-col items-center justify-center gap-1 rounded-lg px-2 text-sap-label text-sap-muted no-underline transition-colors",
              active
                ? "bg-sap-active-nav"
                : "hover:bg-sap-row-hover hover:text-sap-fg",
            )}
          >
            {Icon ? (
              <Icon className="size-4" strokeWidth={1.7} />
            ) : (
              <span className="size-1.5 rounded-full bg-current" />
            )}
            <span className="max-w-[72px] truncate">{item.label}</span>
          </Link>
        );
      })}
      <NavigationPicker navigation={pickerNavigation} trigger="mobile" />
    </nav>
  );
}

export function NavigationPicker({
  navigation,
  trigger,
}: NavigationShellProps & { trigger: "rail" | "mobile" }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const items = useMemo(() => navigationItems(navigation), [navigation]);
  const options = useMemo(
    () => items.map((item) => ({ id: item.to, label: item.label })),
    [items],
  );
  const activeItem = items.find((item) =>
    isNavigationItemActive(item, location),
  );

  const buttonClass = cn(
    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    trigger === "rail"
      ? "inline-flex size-10 items-center justify-center rounded-md text-sap-nav-icon duration-[20ms] ease-in hover:bg-sap-nav-hover"
      : "flex h-12 min-w-[60px] flex-col items-center justify-center gap-1 rounded-lg px-2 text-sap-label text-sap-muted hover:bg-sap-row-hover hover:text-sap-fg",
  );
  const panelClass =
    trigger === "rail"
      ? "absolute bottom-0 left-full ml-3 w-[min(360px,calc(100vw-24px))]"
      : "absolute bottom-full right-0 mb-2 w-[min(360px,calc(100vw-24px))]";

  return (
    <div className="relative">
      <button
        type="button"
        className={buttonClass}
        title="Open navigation"
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ListFilter className="size-[17px]" strokeWidth={1.7} />
        {trigger === "mobile" && <span>Browse</span>}
      </button>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-[calc(var(--sap-z-popover)-1)] cursor-default bg-transparent"
          onClick={() => setOpen(false)}
        />
      )}
      {open && (
        <div
          className={cn(
            panelClass,
            "z-[var(--sap-z-popover)] max-h-[360px] overflow-y-auto rounded-lg border border-sap-border bg-popover p-1.5 text-sap-body text-popover-foreground shadow-sap-elevated",
          )}
        >
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={cn(
                "flex w-full items-center rounded-md px-2.5 py-2 text-left text-sap-data transition-colors hover:bg-sap-row-hover hover:text-sap-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeItem?.to === option.id
                  ? "bg-sap-active-nav text-sap-soft"
                  : "text-sap-soft",
              )}
              onClick={() => {
                navigate(option.id);
                setOpen(false);
              }}
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function includeActiveRailItem(
  visibleItems: NavigationItem[],
  activeItem: NavigationItem,
): NavigationItem[] {
  if (visibleItems.some((item) => item.to === activeItem.to)) {
    return visibleItems;
  }
  if (visibleItems.length < 8) {
    return [...visibleItems, activeItem];
  }
  return [...visibleItems.slice(0, 7), activeItem];
}
