import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@sapporta/ui/cn";
import { useSidebar, type SidebarController } from "../sidebar-controller";

// Only compact screens open the sidebar as a modal sheet, so its dialog
// implementation loads with the layout that uses it.
const SidebarDrawer = lazy(() =>
  import("./SidebarDrawer").then((m) => ({ default: m.SidebarDrawer })),
);

/** How long the pointer rests on the rail before the full sidebar opens. */
export const SIDEBAR_PEEK_OPEN_DELAY_MS = 200;
/** How long the opened sidebar stays after the pointer leaves it. */
export const SIDEBAR_PEEK_CLOSE_DELAY_MS = 300;
/** The collapsed desktop sidebar's width unless `railWidth` says otherwise. */
export const SIDEBAR_RAIL_WIDTH = "4.25rem";

export interface SidebarRegionProps {
  children: ReactNode;
  className?: string;
  /**
   * The width of the collapsed desktop sidebar. Choose it so the sidebar's
   * icons sit in the middle of the rail.
   */
  railWidth?: string;
}

/**
 * Presents the same application navigation in three forms.
 *
 * An expanded desktop sidebar takes the width of what it holds beside the page
 * (`SidebarShell` is 240px; an app's own sidebar sets its own). A collapsed
 * desktop sidebar keeps a narrow rail of icons, `railWidth` wide, so every
 * destination stays one click away. While `useSidebar().rail` is true, the
 * contents fill the rail and hide their text labels. When a mouse rests on the
 * rail, the full sidebar opens over the page, with each item still in its own
 * row, and it closes shortly after the mouse leaves.
 *
 * On a compact screen, the sidebar opens as a modal `Sheet`. It traps focus
 * while open and closes through normal dialog dismissal or after navigation.
 */
export function SidebarRegion({
  children,
  className,
  railWidth = SIDEBAR_RAIL_WIDTH,
}: SidebarRegionProps) {
  const sidebar = useSidebar();
  const peekHandlers = usePeekOnRest(sidebar);

  if (!sidebar.isDesktop) {
    return (
      <Suspense fallback={null}>
        <SidebarDrawer>{children}</SidebarDrawer>
      </Suspense>
    );
  }

  const collapsed = !sidebar.desktopExpanded;

  return (
    <div
      id={sidebar.sidebarId}
      data-sidebar-region
      data-sidebar-state={collapsed ? "collapsed" : "expanded"}
      data-sidebar-peek={sidebar.peekOpen ? "open" : undefined}
      className={cn(
        "relative h-full shrink-0",
        collapsed && "z-[var(--sap-z-popover)]",
        className,
      )}
      style={collapsed ? { width: railWidth } : undefined}
    >
      <div
        data-sidebar-surface
        {...peekHandlers}
        className={cn(
          "h-full",
          collapsed && "absolute inset-y-0 left-0",
          sidebar.peekOpen && "shadow-sap-elevated",
        )}
        style={sidebar.rail ? { width: railWidth } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Opens a collapsed desktop sidebar when a mouse rests on the rail, and closes
 * it shortly after the mouse leaves. Touch input never opens it: a tap on the
 * rail follows the link under the finger.
 *
 * A press anywhere in the sidebar stops resting from opening it until the
 * pointer has left the sidebar. For example, the pointer that presses the
 * collapse control stays on the rail afterwards, and the sidebar must not
 * reopen under it. The pointer need not move for this to matter: pressing the
 * control swaps its icon, and the browser reports the pointer entering the new
 * icon, and so the sidebar, as if from outside the page. A press on a rail icon
 * is covered the same way, so a click follows the link without the sidebar
 * opening over it.
 */
function usePeekOnRest({
  desktopExpanded,
  peekOpen,
  openPeek,
  closePeek,
}: SidebarController) {
  const pressedSinceEntering = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const startTimer = (action: () => void, delay: number) => {
    cancelTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      action();
    }, delay);
  };

  // A pending open or close belongs to the layout it started in.
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [desktopExpanded]);

  return {
    onPointerEnter(event: PointerEvent<HTMLDivElement>) {
      if (event.pointerType === "touch" || desktopExpanded) return;
      if (peekOpen) cancelTimer();
      else if (!pressedSinceEntering.current) {
        startTimer(openPeek, SIDEBAR_PEEK_OPEN_DELAY_MS);
      }
    },
    onPointerLeave() {
      pressedSinceEntering.current = false;
      if (peekOpen) startTimer(closePeek, SIDEBAR_PEEK_CLOSE_DELAY_MS);
      else cancelTimer();
    },
    onPointerDown() {
      pressedSinceEntering.current = true;
      if (!peekOpen) cancelTimer();
    },
  };
}
