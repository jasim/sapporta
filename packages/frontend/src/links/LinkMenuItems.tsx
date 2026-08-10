import type { MouseEvent } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ExternalLink,
} from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@sapporta/ui/context-menu";
import type { LinkIcon } from "@sapporta/shared/contracts";
import { handleResolvedLinkClick, linkRel } from "./open-link";
import type { ResolvedLink } from "./resolve-link";

const ICONS: Record<LinkIcon, typeof ArrowUpRight> = {
  "drill-up": ArrowUpRight,
  "drill-into": ArrowDownRight,
  report: BarChart3,
  external: ExternalLink,
};

export function LinkIconGlyph({
  icon,
  className,
}: {
  icon: LinkIcon;
  className?: string;
}) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden="true" className={className ?? "h-3.5 w-3.5"} />;
}

/**
 * Context-menu entries for the targeted cell and row: the cell's links
 * first, then the row's, one entry per destination. This component owns
 * that ordering and dedupe policy — the table and report grids only supply
 * the two resolved lists. Renders nothing when no link resolved; otherwise
 * a separator followed by one anchor item per link, so middle-click and
 * modifier-click behave like normal links.
 */
export function LinkMenuItems({
  cellLinks = [],
  rowLinks = [],
}: {
  cellLinks?: readonly ResolvedLink[];
  rowLinks?: readonly ResolvedLink[];
}) {
  const links: ResolvedLink[] = [];
  const seen = new Set<string>();
  for (const link of [...cellLinks, ...rowLinks]) {
    if (seen.has(link.href)) continue;
    seen.add(link.href);
    links.push(link);
  }
  if (links.length === 0) return null;
  return (
    <>
      <ContextMenuSeparator />
      {links.map((link) => (
        <ContextMenuItem
          key={link.href}
          render={
            <a
              href={link.href}
              target={link.target}
              rel={linkRel(link.target)}
              data-grid-part="link-menu-item"
            />
          }
          onClick={(event: MouseEvent) => handleResolvedLinkClick(event, link)}
        >
          <LinkIconGlyph icon={link.icon} className="mr-2 h-3.5 w-3.5" />
          {link.label}
        </ContextMenuItem>
      ))}
    </>
  );
}
