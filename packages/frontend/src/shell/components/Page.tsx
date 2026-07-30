import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@sapporta/ui/cn";
import { PageHeader, type PageHeaderProps } from "./PageHeader";

export type PageFrameProps = HTMLAttributes<HTMLDivElement>;

/**
 * A bounded workspace for screens such as tables, reports, and editors. The
 * frame fills the shell instead of growing with its content, so one of its
 * children needs to own overflow.
 */
export const PageFrame = forwardRef<HTMLDivElement, PageFrameProps>(
  function PageFrame({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-page-frame
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden bg-sap-surface",
          className,
        )}
        {...props}
      />
    );
  },
);

export type PageBodyProps = HTMLAttributes<HTMLDivElement>;

/**
 * The standard scrolling child of `PageFrame`. Keeping this as the only
 * scroller leaves a sibling `PageHeader` in place while the content moves.
 */
export const PageBody = forwardRef<HTMLDivElement, PageBodyProps>(
  function PageBody({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-page-body
        className={cn("min-h-0 flex-1 overflow-auto", className)}
        {...props}
      />
    );
  },
);

export interface AppPageProps extends Omit<PageHeaderProps, "className"> {
  children?: ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
}

/**
 * The usual fixed-header page: it combines `PageFrame`, `PageHeader`, and one
 * scrolling `PageBody`. Omit it when an application page should grow naturally
 * or when a custom workspace already owns its height and overflow.
 */
export function AppPage({
  children,
  className,
  headerClassName,
  bodyClassName,
  ...header
}: AppPageProps) {
  return (
    <PageFrame className={className}>
      <PageHeader {...header} className={headerClassName} />
      <PageBody className={bodyClassName}>{children}</PageBody>
    </PageFrame>
  );
}
