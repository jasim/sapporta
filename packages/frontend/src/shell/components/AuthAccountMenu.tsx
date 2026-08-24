import type { ComponentProps } from "react";
import { Building2, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../auth/state/auth-store";
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
      // Owner only: what is on that screen belongs to the workspace and is
      // read by everyone in it, so it is not offered to a member who cannot
      // change it.
      ...(context.workspace.isOwner
        ? [
            {
              id: "workspace-settings",
              label: "Workspace settings",
              description: "Time zone and other workspace-wide settings",
              icon: (
                <Building2 className="h-[13px] w-[13px]" strokeWidth={1.7} />
              ),
              onSelect: () => {
                navigate("/workspace/settings");
              },
            },
          ]
        : []),
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
