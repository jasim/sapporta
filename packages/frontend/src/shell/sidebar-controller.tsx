import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { loadPref, savePref } from "../platform/prefs";

export const SIDEBAR_EXPANDED_PREF_KEY = "sapporta:sidebar-expanded";
export const SIDEBAR_DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";

export interface SidebarController {
  sidebarId: string;
  desktopExpanded: boolean;
  /**
   * Whether a collapsed desktop sidebar is shown at full width over the page,
   * which `SidebarRegion` does while the pointer rests on the rail.
   */
  peekOpen: boolean;
  /**
   * Whether the sidebar is currently the narrow desktop rail. Sidebar contents
   * read this to show icons without labels. It is false while the sidebar is
   * expanded, while it is open over the page, and on compact screens.
   */
  rail: boolean;
  drawerOpen: boolean;
  isDesktop: boolean;
  toggleDesktop: () => void;
  expandDesktop: () => void;
  collapseDesktop: () => void;
  openPeek: () => void;
  closePeek: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  /**
   * Closes whichever temporary presentation is showing: the compact drawer, or
   * the sidebar opened over the page from the rail. Sidebar contents pass this
   * as `onNavigate`, so choosing a destination gives the page back without
   * waiting for the pointer to leave.
   */
  closeTemporary: () => void;
}

const SidebarContext = createContext<SidebarController | null>(null);

export interface SidebarProviderOptions {
  defaultExpanded?: boolean;
  storageKey?: string;
  desktopMediaQuery?: string;
}

export interface SidebarProviderProps extends SidebarProviderOptions {
  children: ReactNode;
}

/**
 * Shares sidebar controls with the shell and any application-owned toolbar.
 * The desktop expanded choice survives reloads. The compact drawer and the
 * full sidebar shown over the page from the rail do not: the drawer closes
 * after navigation, dismissal, or a move back to desktop, and the sidebar over
 * the page closes when the expanded choice or the screen size changes.
 */
export function SidebarProvider({
  children,
  defaultExpanded = true,
  storageKey = SIDEBAR_EXPANDED_PREF_KEY,
  desktopMediaQuery = SIDEBAR_DESKTOP_MEDIA_QUERY,
}: SidebarProviderProps) {
  const sidebarId = `sapporta-sidebar-${useId().replaceAll(":", "")}`;
  const [desktopExpanded, setDesktopExpandedState] = useState(() =>
    loadPref(storageKey, defaultExpanded),
  );
  const [peekOpen, setPeekOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDesktop = useMediaQuery(desktopMediaQuery);

  const setDesktopExpanded = useCallback(
    (expanded: boolean) => {
      setDesktopExpandedState(expanded);
      setPeekOpen(false);
      savePref(storageKey, expanded);
    },
    [storageKey],
  );

  const toggleDesktop = useCallback(() => {
    setDesktopExpandedState((current) => {
      const expanded = !current;
      savePref(storageKey, expanded);
      return expanded;
    });
    setPeekOpen(false);
  }, [storageKey]);
  const expandDesktop = useCallback(
    () => setDesktopExpanded(true),
    [setDesktopExpanded],
  );
  const collapseDesktop = useCallback(
    () => setDesktopExpanded(false),
    [setDesktopExpanded],
  );
  const openPeek = useCallback(() => {
    if (isDesktop && !desktopExpanded) setPeekOpen(true);
  }, [desktopExpanded, isDesktop]);
  const closePeek = useCallback(() => setPeekOpen(false), []);
  const openDrawer = useCallback(() => {
    if (!isDesktop) setDrawerOpen(true);
  }, [isDesktop]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const closeTemporary = useCallback(() => {
    setDrawerOpen(false);
    setPeekOpen(false);
  }, []);

  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
    else setPeekOpen(false);
  }, [isDesktop]);

  const rail = isDesktop && !desktopExpanded && !peekOpen;

  const value = useMemo<SidebarController>(
    () => ({
      sidebarId,
      desktopExpanded,
      peekOpen,
      rail,
      drawerOpen,
      isDesktop,
      toggleDesktop,
      expandDesktop,
      collapseDesktop,
      openPeek,
      closePeek,
      openDrawer,
      closeDrawer,
      closeTemporary,
    }),
    [
      closeDrawer,
      closePeek,
      closeTemporary,
      collapseDesktop,
      desktopExpanded,
      drawerOpen,
      expandDesktop,
      isDesktop,
      openDrawer,
      openPeek,
      peekOpen,
      rail,
      sidebarId,
      toggleDesktop,
    ],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarController {
  const sidebar = useContext(SidebarContext);
  if (!sidebar) {
    throw new Error("useSidebar must be used inside SidebarProvider.");
  }
  return sidebar;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
