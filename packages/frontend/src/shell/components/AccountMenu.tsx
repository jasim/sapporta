import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { ChevronRight, LogOut, UserRound } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@sapporta/ui";
import type {
  AuthContextResponse,
  AuthCurrentUser,
  AuthRole,
} from "@sapporta/shared/contracts";

export interface AccountMenuAction {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  variant?: "default" | "danger";
  pendingLabel?: string;
  onSelect: () => void | Promise<void>;
}

export interface AccountMenuSection {
  id: string;
  label?: string;
  actions: AccountMenuAction[];
}

export interface AccountMenuTriggerRenderProps {
  displayName: string;
  initials: string;
  secondaryLabel: string;
  open: boolean;
}

export interface AccountMenuProps {
  context: AuthContextResponse;
  sections?: AccountMenuSection[];
  onLogout?: () => void | Promise<void>;
  footer?: ReactNode;
  triggerAriaLabel?: string;
  renderTrigger?: (props: AccountMenuTriggerRenderProps) => ReactElement;
}

export function AccountMenu({
  context,
  sections = [],
  onLogout,
  footer,
  triggerAriaLabel,
  renderTrigger,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const displayName = getAccountDisplayName(context.user);
  const secondaryLabel = getAccountSecondaryLabel(context);
  const initials = getAccountInitials(context.user);
  const logoutSection: AccountMenuSection | null = onLogout
    ? {
        id: "session",
        actions: [
          {
            id: "logout",
            label: "Log out",
            icon: <LogOut className="h-[13px] w-[13px]" strokeWidth={1.7} />,
            variant: "danger",
            pendingLabel: "Logging out...",
            onSelect: onLogout,
          },
        ],
      }
    : null;
  const allSections: AccountMenuSection[] = logoutSection
    ? [...sections, logoutSection]
    : sections;

  async function runAction(action: AccountMenuAction) {
    if (action.disabled || pendingActionId) return;
    setPendingActionId(action.id);
    setActionError(null);
    try {
      await action.onSelect();
      setOpen(false);
    } catch (err) {
      console.error("Account menu action failed", err);
      setActionError(errorMessage(err));
    } finally {
      setPendingActionId(null);
    }
  }

  const trigger = renderTrigger ? (
    renderTrigger({ displayName, initials, secondaryLabel, open })
  ) : (
    <DefaultAccountMenuTrigger
      displayName={displayName}
      initials={initials}
      secondaryLabel={secondaryLabel}
      open={open}
      ariaLabel={triggerAriaLabel}
    />
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-[260px] p-0 text-sap-body"
      >
        <div className="border-b border-sap-border-soft px-3 py-3">
          <div className="flex items-center gap-2">
            <AccountAvatar initials={initials} />
            <div className="min-w-0">
              <div className="truncate font-[650] text-sap-fg">
                {displayName}
              </div>
              <div className="truncate text-sap-menu text-sap-muted">
                {context.user.email}
              </div>
            </div>
          </div>
          <div className="mt-2 truncate text-sap-menu text-sap-subtle">
            {secondaryLabel}
          </div>
        </div>

        {allSections.map((section) => (
          <div
            key={section.id}
            className="border-b border-sap-border-soft p-1 last:border-b-0"
          >
            {section.label && (
              <div className="px-2 py-1 text-sap-label font-bold uppercase tracking-sap-section text-sap-subtle">
                {section.label}
              </div>
            )}
            {section.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={action.disabled || pendingActionId !== null}
                aria-busy={pendingActionId === action.id}
                onClick={() => void runAction(action)}
                className={cx(
                  "flex w-full items-center gap-2 rounded-[5px] px-2 py-[7px] text-left text-sap-data disabled:cursor-not-allowed disabled:opacity-60",
                  action.variant === "danger"
                    ? "text-sap-negative hover:bg-sap-negative/10"
                    : "text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg",
                )}
              >
                <span className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                  {action.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {pendingActionId === action.id
                      ? action.pendingLabel ?? `${action.label}...`
                      : action.label}
                  </span>
                  {action.description && (
                    <span className="block truncate text-sap-menu text-sap-muted">
                      {action.description}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ))}

        {actionError && (
          <div
            role="alert"
            className="border-t border-sap-border-soft px-3 py-2 text-sap-menu text-sap-negative"
          >
            {actionError}
          </div>
        )}

        {footer && (
          <div className="border-t border-sap-border-soft px-3 py-2">
            {footer}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function getAccountDisplayName(user: AuthCurrentUser): string {
  const name = user.name?.trim();
  return name && name.length > 0 ? name : user.email;
}

export function getAccountInitials(user: AuthCurrentUser): string {
  const displayName = getAccountDisplayName(user);
  const parts = displayName
    .split(/[\s@._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[1]?.[0] : undefined;
  return `${first}${second ?? ""}`.toUpperCase();
}

export function getAccountSecondaryLabel(context: AuthContextResponse): string {
  return `${context.workspace.name} - ${formatAuthRole(context.role)}`;
}

export function formatAuthRole(role: AuthRole): string {
  return role === "owner" ? "Owner" : "Member";
}

interface DefaultAccountMenuTriggerProps
  extends AccountMenuTriggerRenderProps,
    ButtonHTMLAttributes<HTMLButtonElement> {
  ariaLabel?: string;
}

const DefaultAccountMenuTrigger = forwardRef<
  HTMLButtonElement,
  DefaultAccountMenuTriggerProps
>(function DefaultAccountMenuTrigger(
  {
    displayName,
    initials,
    secondaryLabel,
    open,
    ariaLabel,
    className,
    ...props
  },
  ref,
) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      aria-label={ariaLabel ?? `Open account menu for ${displayName}`}
      aria-expanded={open}
      className={cx(
        "h-auto w-full justify-start gap-2 rounded-[6px] px-2 py-[7px] text-left hover:bg-sap-row-hover",
        className,
      )}
      {...props}
    >
      <AccountAvatar initials={initials} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sap-body font-[650] text-sap-fg">
          {displayName}
        </span>
        <span className="block truncate text-sap-menu font-normal text-sap-muted">
          {secondaryLabel}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="h-[13px] w-[13px] shrink-0 text-sap-subtle"
        strokeWidth={1.7}
      />
    </Button>
  );
});

function AccountAvatar({ initials }: { initials: string }) {
  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-sap-active-nav text-sap-label font-bold text-sap-brand">
      {initials === "?" ? (
        <UserRound aria-hidden="true" className="h-[14px] w-[14px]" />
      ) : (
        initials
      )}
    </span>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Could not complete action.";
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
