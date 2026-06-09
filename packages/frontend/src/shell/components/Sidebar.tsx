import { type ReactNode, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ListFilter, Search } from "lucide-react";
import { useSchemaStore } from "@/schema-catalog/state/schema-store";
import { AuthAccountMenu } from "./AuthAccountMenu";
import { SidebarShell } from "./SidebarShell";
import {
  isNavigationItemActive,
  navigationItems,
  type Navigation,
  type NavigationItem,
} from "../navigation";

export interface NavigationShellProps {
  navigation: Navigation;
}

export function SapportaMark({ size = 17 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block rounded-[5px]"
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
      <SapportaMark size={18} />
      <span className="text-sap-body font-bold tracking-sap-display truncate">
        {name ?? ""}
      </span>
    </>
  );
}

export function NavSection({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mt-[18px] mb-[6px] px-[2px] flex items-center justify-between text-sap-label font-bold uppercase tracking-sap-section text-sap-subtle">
        <span>{label}</span>
      </div>
      <div>{children}</div>
    </section>
  );
}

export function NavItem({
  item,
  active,
  compact = false,
}: {
  item: NavigationItem;
  active: boolean;
  compact?: boolean;
}) {
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      title={compact ? item.label : undefined}
      aria-label={compact ? item.label : undefined}
      className={cx(
        "flex items-center rounded-[6px] text-sap-body no-underline",
        compact
          ? "h-10 w-10 justify-center"
          : "gap-2 h-[28px] px-2",
        active
          ? "bg-sap-active-nav text-sap-fg font-[650]"
          : "text-sap-soft hover:bg-sap-row-hover",
      )}
    >
      <span
        className={cx(
          "inline-flex items-center justify-center shrink-0",
          compact ? "h-5 w-5" : "w-[14px] h-[14px]",
          active ? "text-sap-brand mono text-sap-data" : "text-sap-subtle",
        )}
      >
        {active && !compact ? (
          "▸"
        ) : Icon ? (
          <Icon
            className={compact ? "h-[17px] w-[17px]" : "h-[12px] w-[12px]"}
            strokeWidth={1.5}
          />
        ) : (
          <span className="h-[6px] w-[6px] rounded-full bg-current" />
        )}
      </span>
      {!compact && (
        <span className="flex-1 min-w-0 truncate">{item.label}</span>
      )}
    </Link>
  );
}

export function DesktopSidebar({ navigation }: NavigationShellProps) {
  const location = useLocation();

  return (
    <SidebarShell header={<SidebarHeader />} footer={<DefaultSidebarFooter />}>
      {navigation.map((section) => (
        <NavSection key={section.label} label={section.label}>
          {section.items.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              active={isNavigationItemActive(item, location)}
            />
          ))}
        </NavSection>
      ))}
    </SidebarShell>
  );
}

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
    <aside className="hidden md:flex lg:hidden w-[64px] shrink-0 border-r border-sap-border-soft bg-sap-sidebar text-sap-fg flex-col items-center h-full py-4">
      <SapportaMark size={20} />
      <nav className="mt-6 flex flex-col gap-1">
        {items.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            active={isNavigationItemActive(item, location)}
            compact
          />
        ))}
      </nav>
      <div className="flex-1" />
      <NavigationPicker navigation={navigation} trigger="rail" />
    </aside>
  );
}

export function MobileBottomNav({
  navigation,
  pickerNavigation,
}: NavigationShellProps & { pickerNavigation: Navigation }) {
  const location = useLocation();
  const stableItems = navigationItems(navigation).slice(0, 3);

  return (
    <nav className="md:hidden fixed inset-x-0 bottom-[var(--height-sap-bar)] z-[var(--sap-z-shell-sticky)] h-[56px] border-t border-sap-border bg-sap-sidebar px-2 flex items-center justify-around">
      {stableItems.map((item) => {
        const active = isNavigationItemActive(item, location);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cx(
              "min-w-[56px] h-12 px-2 rounded-[6px] flex flex-col items-center justify-center gap-1 text-sap-label no-underline",
              active
                ? "text-sap-fg bg-sap-active-nav font-[650]"
                : "text-sap-soft",
            )}
          >
            {Icon ? (
              <Icon className="h-[16px] w-[16px]" strokeWidth={1.5} />
            ) : (
              <span className="h-[6px] w-[6px] rounded-full bg-current" />
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
  const [query, setQuery] = useState("");
  const location = useLocation();
  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return navigationItems(navigation).filter((item) => {
      if (normalized.length === 0) {
        return true;
      }
      return item.label.toLowerCase().includes(normalized);
    });
  }, [navigation, query]);

  const buttonClass =
    trigger === "rail"
      ? "h-10 w-10 rounded-[6px] inline-flex items-center justify-center text-sap-soft hover:bg-sap-row-hover"
      : "min-w-[56px] h-12 px-2 rounded-[6px] flex flex-col items-center justify-center gap-1 text-sap-label text-sap-soft";

  return (
    <div className="relative">
      <button
        type="button"
        className={buttonClass}
        title="Open navigation"
        aria-label="Open navigation"
        onClick={() => setOpen((value) => !value)}
      >
        <ListFilter className="h-[17px] w-[17px]" strokeWidth={1.5} />
        {trigger === "mobile" && <span>Browse</span>}
      </button>
      {open && (
        <div
          className={cx(
            "fixed z-[calc(var(--sap-z-shell-sticky)+1)] w-[min(360px,calc(100vw-24px))] rounded-[8px] border border-sap-border bg-sap-surface shadow-lg",
            trigger === "rail"
              ? "left-[76px] bottom-[44px]"
              : "left-3 right-3 bottom-[calc(var(--height-sap-bar)+68px)]",
          )}
        >
          <div className="p-2 border-b border-sap-border-soft flex items-center gap-2">
            <Search className="h-[14px] w-[14px] text-sap-subtle" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
              placeholder="Find a table, report, or view"
              className="min-w-0 flex-1 bg-transparent outline-none text-sap-body text-sap-fg placeholder:text-sap-muted"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto p-2">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cx(
                  "flex items-center gap-2 h-9 rounded-[6px] px-2 text-sap-body no-underline",
                  isNavigationItemActive(item, location)
                    ? "bg-sap-active-nav text-sap-fg font-[650]"
                    : "text-sap-soft hover:bg-sap-row-hover",
                )}
              >
                {item.icon && (
                  <item.icon className="h-[14px] w-[14px]" strokeWidth={1.5} />
                )}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            ))}
            {items.length === 0 && (
              <div className="px-2 py-6 text-center text-sap-muted text-sap-body">
                No matches
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
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

function SidebarKbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mono text-sap-label font-normal rounded-[3px] px-[5px] py-[1px] inline-flex items-center justify-center border border-sap-border bg-sap-kbd text-sap-subtle">
      {children}
    </kbd>
  );
}

function DefaultSidebarFooter() {
  return (
    <div className="space-y-2">
      <AuthAccountMenu />
      <div className="flex items-center gap-2">
        <SidebarKbd>⌘K</SidebarKbd>
        <span className="text-sap-menu text-sap-muted">Command menu</span>
      </div>
    </div>
  );
}
