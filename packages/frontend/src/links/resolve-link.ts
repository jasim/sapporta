import {
  substituteHrefPlaceholders,
  type LinkIcon,
  type LinkTarget,
  type NavLink,
} from "@sapporta/shared/contracts";
import { tableFilteredByUrl } from "../table/grid-adapter/tgrid-table-url";

/**
 * A `NavLink` resolved against one row's values: a concrete destination
 * the UI can render as an anchor or a context-menu entry.
 */
export type ResolvedLink = {
  href: string;
  label: string;
  icon: LinkIcon;
  target: LinkTarget;
};

export type LinkResolutionContext = {
  /** The current row's values, keyed by source column name. */
  values: Readonly<Record<string, unknown>>;
  /** Optional display-label lookup for `kind: "table"` link destinations. */
  tableLabel?: (table: string) => string | undefined;
};

/**
 * Resolve one declarative link against a row.
 *
 * Returns null when any bound source value is missing or null — a row that
 * lacks the value simply doesn't offer the link. This is what makes binds
 * safe on nullable FK columns and on synthetic report rows (opening,
 * closing, subtotal) whose `columns` omit the identifiers. Binds naming
 * columns that don't exist at all are rejected earlier — at server boot for
 * table-declared links, at grid binding for dataset-declared ones — so a
 * null here always means "this row lacks the value".
 */
export function resolveLink(
  link: NavLink,
  context: LinkResolutionContext,
): ResolvedLink | null {
  const bound = resolveBind(link.bind ?? {}, context.values);
  if (bound === null) return null;

  switch (link.kind) {
    case "table": {
      const label =
        link.label ??
        `Open ${context.tableLabel?.(link.table) ?? link.table}`;
      return {
        href: tableFilteredByUrl(link.table, bound),
        label,
        icon: link.icon ?? "drill-into",
        target: link.target ?? "_self",
      };
    }
    case "report": {
      const base = link.report.startsWith("/")
        ? link.report
        : `/reports/${link.report}`;
      return {
        href: withQueryParams(base, bound),
        label: link.label ?? "Open report",
        icon: link.icon ?? "report",
        target: link.target ?? "_self",
      };
    }
    case "url": {
      const substituted = substituteHrefPlaceholders(
        link.href,
        context.values,
      );
      if (substituted === null) return null;
      return {
        href: withQueryParams(substituted, bound),
        label: link.label ?? "Open link",
        icon: link.icon ?? "external",
        target: link.target ?? (isExternalHref(substituted) ? "_blank" : "_self"),
      };
    }
  }
}

/**
 * Resolve a list of declarative links against a row, dropping links whose
 * bound values are missing and deduplicating identical destinations.
 */
export function resolveLinks(
  links: readonly NavLink[] | undefined,
  context: LinkResolutionContext,
): ResolvedLink[] {
  if (!links || links.length === 0) return [];
  const out: ResolvedLink[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const resolved = resolveLink(link, context);
    if (!resolved || seen.has(resolved.href)) continue;
    seen.add(resolved.href);
    out.push(resolved);
  }
  return out;
}

/** Maps each bind target name to the row's source value; null when any
 *  source value is absent. */
function resolveBind(
  bind: Readonly<Record<string, string>>,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> | null {
  const resolved: Record<string, unknown> = {};
  for (const [targetName, sourceColumn] of Object.entries(bind)) {
    const value = values[sourceColumn];
    if (value === null || value === undefined) return null;
    resolved[targetName] = value;
  }
  return resolved;
}

function withQueryParams(
  base: string,
  params: Readonly<Record<string, unknown>>,
): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return base;
  const search = new URLSearchParams();
  for (const [name, value] of entries) {
    search.set(name, String(value));
  }
  return `${base}${base.includes("?") ? "&" : "?"}${search.toString()}`;
}

/** True when the href leaves the app: it carries a scheme ("https:",
 *  "mailto:") rather than an in-app path. */
export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}
