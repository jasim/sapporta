import type { ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";
import { Kbd } from "@sapporta/ui/kbd";
import { usePageTitle } from "../document-title";

export interface PageHeaderProps {
  /** The group this view belongs to — "Tables", "Reports", etc. */
  section?: string;
  /** The view's own name. Also shown in the browser tab. */
  title: string;
  /**
   * A different browser tab title, or `false` for a header that should not
   * name the tab — for example one embedded in a side panel.
   */
  documentTitle?: string | false;
  /** Mono-styled right-of-title metadata (record counts, timing, etc.). */
  subtitle?: ReactNode;
  /** Right-aligned page actions. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The standard header for a bounded page. It stays in place because the
 * adjacent `PageBody` scrolls; it does not rely on sticky positioning.
 *
 * A shell that places a control over the content's top-left corner (the
 * collapsed-sidebar toggle in `AppShell`) sets `--sap-page-header-inset` to
 * that control's width on the scroll region, and the header adds it to its
 * leading padding so the title is not covered. `AppShell` does this; an app
 * that renders its own shell does the same.
 */
export function PageHeader({
  section,
  title,
  documentTitle,
  subtitle,
  actions,
  className,
}: PageHeaderProps) {
  usePageTitle(documentTitle ?? title);

  return (
    <header
      data-page-header
      className={cn(
        "z-[var(--sap-z-shell-sticky)] flex h-sap-topbar shrink-0 items-center gap-2 border-b border-sap-border-soft bg-sap-surface/90 pl-[calc(var(--sap-page-header-inset,0px)+0.75rem)] pr-3 sm:pl-[calc(var(--sap-page-header-inset,0px)+1.25rem)] sm:pr-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-[14px]">
        {section && (
          <>
            <span className="hidden text-sap-body text-sap-muted sm:inline">
              {section}
            </span>
            <span className="hidden text-sap-body text-sap-subtle sm:inline">
              /
            </span>
          </>
        )}
        <h1 className="truncate text-sap-body font-bold text-sap-fg">
          {title}
        </h1>
        {subtitle && (
          <span className="mono hidden shrink-0 text-sap-menu text-sap-muted sm:inline">
            {subtitle}
          </span>
        )}
      </div>
      <div className="flex-1" />
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Action button for the page header. Three tones:
 *   - primary: the affirmative action (New record, Save, etc.)
 *   - ghost:   secondary actions (Export, Filter, etc.)
 *   - danger:  destructive
 *
 * An optional `shortcut` prop renders a trailing Kbd chip: framed on ghost
 * buttons (reads as metadata on the surface bg), inverted on primary/danger
 * buttons (translucent-white wash on the solid fill).
 */
export function PageHeaderButton({
  tone = "ghost",
  icon,
  onClick,
  href,
  download,
  shortcut,
  disabled,
  children,
}: {
  tone?: "primary" | "ghost" | "danger";
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  download?: boolean;
  shortcut?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const toneCls =
    tone === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90 border border-transparent"
      : tone === "danger"
        ? "bg-sap-negative text-primary-foreground hover:bg-sap-negative/90 border border-transparent"
        : "bg-sap-surface text-sap-soft hover:bg-sap-row-hover border border-sap-border";

  const cls = cn(
    "inline-flex items-center gap-[6px] h-sap-ctl px-[10px] rounded-md text-sap-emph font-[650] whitespace-nowrap disabled:pointer-events-none disabled:opacity-40",
    toneCls,
  );

  const kbdVariant = tone === "ghost" ? "framed" : "inverted";
  const content = (
    <>
      {icon}
      {children}
      {shortcut && <Kbd variant={kbdVariant}>{shortcut}</Kbd>}
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} download={download} className={cls}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} disabled={disabled}>
      {content}
    </button>
  );
}
