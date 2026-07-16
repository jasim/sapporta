import { type ReactNode, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@sapporta/ui/cn";
import { ListFilter } from "lucide-react";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";
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
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1 pt-4 first:pt-0">
      <div className="flex items-center justify-between px-2 text-sap-label font-bold uppercase tracking-sap-section text-sap-subtle">
        <span>{label}</span>
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
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
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center rounded-lg text-sap-body text-sap-soft no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-sap-sidebar",
        compact ? "size-10 justify-center" : "h-9 gap-2.5 px-2.5",
        active
          ? "bg-sap-active-nav"
          : "hover:bg-sap-row-hover hover:text-sap-fg",
      )}
    >
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center text-sap-subtle transition-colors group-hover:text-sap-muted",
          compact ? "size-5" : "size-4",
        )}
      >
        {Icon ? (
          <Icon
            className={compact ? "size-[17px]" : "size-[15px]"}
            strokeWidth={1.7}
          />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
      </span>
      {!compact && (
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      )}
    </Link>
  );
}

export function DesktopSidebar({ navigation }: NavigationShellProps) {
  const location = useLocation();

  return (
    <SidebarShell header={<SidebarHeader />} footer={<AuthAccountMenu />}>
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
    <aside className="hidden h-full w-[68px] shrink-0 flex-col items-center border-r border-sap-border-soft bg-sap-sidebar py-4 text-sap-fg md:flex lg:hidden">
      <SapportaMark size={22} />
      <nav aria-label="Primary" className="mt-6 flex flex-col gap-1.5">
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
      ? "inline-flex size-10 items-center justify-center rounded-lg text-sap-muted hover:bg-sap-row-hover hover:text-sap-fg"
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
            "z-[var(--sap-z-popover)] max-h-[360px] overflow-y-auto rounded-lg border border-sap-border bg-popover p-1.5 text-sap-body text-popover-foreground shadow-lg",
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
