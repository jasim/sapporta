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
  drawerOpen: boolean;
  isDesktop: boolean;
  toggleDesktop: () => void;
  expandDesktop: () => void;
  collapseDesktop: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
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
 * The desktop expanded choice survives reloads. The compact drawer does not:
 * it closes after navigation, dismissal, or a move back to desktop.
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDesktop = useMediaQuery(desktopMediaQuery);

  const setDesktopExpanded = useCallback(
    (expanded: boolean) => {
      setDesktopExpandedState(expanded);
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
  }, [storageKey]);
  const expandDesktop = useCallback(
    () => setDesktopExpanded(true),
    [setDesktopExpanded],
  );
  const collapseDesktop = useCallback(
    () => setDesktopExpanded(false),
    [setDesktopExpanded],
  );
  const openDrawer = useCallback(() => {
    if (!isDesktop) setDrawerOpen(true);
  }, [isDesktop]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  const value = useMemo<SidebarController>(
    () => ({
      sidebarId,
      desktopExpanded,
      drawerOpen,
      isDesktop,
      toggleDesktop,
      expandDesktop,
      collapseDesktop,
      openDrawer,
      closeDrawer,
    }),
    [
      closeDrawer,
      collapseDesktop,
      desktopExpanded,
      drawerOpen,
      expandDesktop,
      isDesktop,
      openDrawer,
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
