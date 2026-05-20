import type { ReactNode } from "react";
import { cn } from "@/ui/utils/cn";
import { Kbd } from "@/ui/composite/kbd";

/**
 * Application top bar. 52px tall, sits on the content surface with a
 * hairline border below. Left side: breadcrumb (section/title) + optional
 * subtitle in mono. Right side: actions slot (buttons, search, etc.).
 *
 * Layout rule: everything in the top bar is either 30px tall (buttons,
 * search input) or vertically centered text. Nothing taller.
 */
export function TopBar({
  section,
  title,
  subtitle,
  actions,
}: {
  /** The group this view belongs to — "Tables", "Reports", etc. */
  section?: string;
  /** The view's own name. */
  title: string;
  /** Mono-styled right-of-title metadata (record counts, timing, etc.). */
  subtitle?: ReactNode;
  /** Right-aligned slot. Actions should be 30px tall to match the bar. */
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 h-sap-topbar shrink-0 flex items-center px-5 gap-[14px] border-b border-sap-border-soft bg-sap-surface/90">
      {section && (
        <>
          <span className="text-sap-body text-sap-muted">{section}</span>
          <span className="text-sap-body text-sap-subtle">/</span>
        </>
      )}
      <span className="text-[15px] font-[720] text-sap-fg">{title}</span>
      {subtitle && (
        <span className="mono text-[11.5px] text-sap-muted ml-1">
          {subtitle}
        </span>
      )}
      <div className="flex-1" />
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Action button for the top bar. Three tones:
 *   - primary: the affirmative action (New record, Save, etc.)
 *   - ghost:   secondary actions (Export, Filter, etc.)
 *   - danger:  destructive
 *
 * An optional `shortcut` prop renders a trailing Kbd chip: framed on ghost
 * buttons (reads as metadata on the surface bg), inverted on primary/danger
 * buttons (translucent-white wash on the solid fill).
 */
export function TopBarButton({
  tone = "ghost",
  icon,
  onClick,
  href,
  download,
  shortcut,
  children,
}: {
  tone?: "primary" | "ghost" | "danger";
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  download?: boolean;
  shortcut?: string;
  children: ReactNode;
}) {
  const toneCls =
    tone === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90 border border-transparent"
      : tone === "danger"
        ? "bg-sap-negative text-primary-foreground hover:bg-sap-negative/90 border border-transparent"
        : "bg-sap-surface text-sap-soft hover:bg-sap-row-hover border border-sap-border";

  const cls = cn(
    "inline-flex items-center gap-[6px] h-sap-ctl px-[10px] rounded-[6px] text-sap-emph font-[650] whitespace-nowrap",
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

  if (href) {
    return (
      <a href={href} download={download} className={cls}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {content}
    </button>
  );
}
