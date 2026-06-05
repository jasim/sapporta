import type { ComponentProps } from "react";
import { useAuthStore } from "@/auth/state/auth-store";
import { AccountMenu } from "./AccountMenu";

export interface AuthAccountMenuProps
  extends Omit<ComponentProps<typeof AccountMenu>, "context" | "onLogout"> {
  onLogout?: () => void | Promise<void>;
}

export function AuthAccountMenu(props: AuthAccountMenuProps) {
  const context = useAuthStore((s) => s.context);
  const logout = useAuthStore((s) => s.logout);

  if (!context) return null;

  return (
    <AccountMenu
      {...props}
      context={context}
      onLogout={props.onLogout ?? logout}
    />
  );
}
