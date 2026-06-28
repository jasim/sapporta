import type { ComponentProps } from "react";
import { UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/auth/state/auth-store";
import { AccountMenu, type AccountMenuSection } from "./AccountMenu";

export interface AuthAccountMenuProps extends Omit<
  ComponentProps<typeof AccountMenu>,
  "context" | "onLogout"
> {
  onLogout?: () => void | Promise<void>;
}

export function AuthAccountMenu(props: AuthAccountMenuProps) {
  const { sections = [], ...accountMenuProps } = props;
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  if (session.kind !== "authenticated") return null;
  const { context } = session;

  const profileSection: AccountMenuSection = {
    id: "account",
    actions: [
      {
        id: "profile",
        label: "Profile",
        description: "Account and workspace details",
        icon: <UserRound className="h-[13px] w-[13px]" strokeWidth={1.7} />,
        onSelect: () => {
          navigate("/account/profile");
        },
      },
    ],
  };

  return (
    <AccountMenu
      {...accountMenuProps}
      context={context}
      onLogout={props.onLogout ?? logout}
      sections={[profileSection, ...sections]}
    />
  );
}
