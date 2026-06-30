import {
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Search } from "lucide-react";
import { cn } from "@sapporta/ui/cn";
import { useDebounce } from "@sapporta/ui/use-debounce";

export function formatRecordCount(totalCount: number): string {
  return `${totalCount} record${totalCount === 1 ? "" : "s"}`;
}

export function SearchInput({
  value,
  onChange,
  compact = false,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  compact?: boolean;
}) {
  // Keep typing instant, then publish the settled search term to the table.
  const [input, setInput] = useState(value ?? "");
  const debounced = useDebounce(input, 250);

  useEffect(() => {
    setInput(value ?? "");
  }, [value]);

  useEffect(() => {
    const normalized = debounced.trim() === "" ? null : debounced;
    if (normalized !== (value ?? null)) {
      onChange(normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div
      className={cn(
        "relative flex items-center rounded-[6px] border border-sap-border bg-sap-surface pl-[30px] pr-[10px]",
        compact ? "h-10 w-full" : "h-sap-ctl w-[260px]",
      )}
    >
      <Search className="absolute left-[10px] h-3.5 w-3.5 text-sap-subtle" />
      <input
        type="search"
        value={input}
        placeholder="Search..."
        className="min-w-0 flex-1 bg-transparent text-sap-emph text-sap-fg outline-none placeholder:text-sap-subtle"
        onChange={(e) => setInput(e.target.value)}
      />
    </div>
  );
}

type CompactHeaderButtonTone = "primary" | "ghost" | "danger";

type CompactHeaderButtonProps = {
  tone?: CompactHeaderButtonTone;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function CompactHeaderButton({
  tone = "ghost",
  icon,
  children,
  className,
  ...props
}: CompactHeaderButtonProps) {
  return (
    <button
      type="button"
      className={compactHeaderButtonClassName(tone, className)}
      {...props}
    >
      {icon}
      {children && <span className="truncate">{children}</span>}
    </button>
  );
}

type CompactHeaderLinkProps = {
  tone?: Exclude<CompactHeaderButtonTone, "danger">;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
} & AnchorHTMLAttributes<HTMLAnchorElement>;

export function CompactHeaderLink({
  tone = "ghost",
  icon,
  children,
  className,
  ...props
}: CompactHeaderLinkProps) {
  return (
    <a className={compactHeaderButtonClassName(tone, className)} {...props}>
      {icon}
      <span className="truncate">{children}</span>
    </a>
  );
}

function compactHeaderButtonClassName(
  tone: CompactHeaderButtonTone,
  className?: string,
): string {
  const toneClass =
    tone === "primary"
      ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
      : tone === "danger"
        ? "border-transparent bg-sap-negative text-primary-foreground hover:bg-sap-negative/90"
        : "border-sap-border bg-sap-surface text-sap-soft hover:bg-sap-row-hover hover:text-sap-fg";

  return cn(
    "inline-flex h-11 min-w-11 max-w-full items-center justify-center gap-2 rounded-[6px] border px-3 text-sap-emph font-[650] whitespace-nowrap disabled:pointer-events-none disabled:opacity-40",
    toneClass,
    className,
  );
}
