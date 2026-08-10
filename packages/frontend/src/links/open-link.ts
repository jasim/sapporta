import type { LinkTarget } from "@sapporta/shared/contracts";
import { getNavigate } from "../app/router/router-bridge";
import type { ResolvedLink } from "./resolve-link";

/** `rel` for anchors that open a new tab: sever opener access. */
export function linkRel(
  target: LinkTarget | undefined,
): "noopener noreferrer" | undefined {
  return target === "_blank" ? "noopener noreferrer" : undefined;
}

/**
 * Open a resolved link the way an anchor would: new tab for `_blank`,
 * client-side route navigation for in-app paths (falling back to a full
 * page load when the router bridge is not initialized), and a plain
 * location change for external URLs.
 */
export function openResolvedLink(
  link: Pick<ResolvedLink, "href" | "target">,
): void {
  if (link.target === "_blank") {
    window.open(link.href, "_blank", "noopener,noreferrer");
    return;
  }
  if (link.href.startsWith("/")) {
    try {
      getNavigate()(link.href);
      return;
    } catch {
      // Router bridge not initialized — fall through to a full page load.
    }
  }
  window.location.assign(link.href);
}

/**
 * Anchor click handler that upgrades in-app navigation to a client-side
 * route change while preserving native anchor behavior for modified
 * clicks (new tab, download, etc.).
 */
export function handleResolvedLinkClick(
  event: {
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    preventDefault(): void;
  },
  link: Pick<ResolvedLink, "href" | "target">,
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.target === "_blank" ||
    !link.href.startsWith("/")
  ) {
    return;
  }
  try {
    const navigate = getNavigate();
    event.preventDefault();
    navigate(link.href);
  } catch {
    // Router bridge not initialized — let the anchor navigate natively.
  }
}
