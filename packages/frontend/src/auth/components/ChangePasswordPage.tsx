import { ArrowLeft, KeyRound } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@sapporta/ui/button";
import { Input } from "@sapporta/ui/input";
import { Label } from "@sapporta/ui/label";
import { errorMessage } from "../../platform/http";
import { changePassword } from "../api/auth-context";
import { useAuthStore } from "../state/auth-store";

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const session = useAuthStore((state) => state.session);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (session.kind === "unknown" || session.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sap-muted">
        Loading...
      </div>
    );
  }

  if (session.kind !== "authenticated") {
    return (
      <div className="flex h-full items-center justify-center text-sap-muted">
        Not signed in.
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      toast.success("Password changed successfully.");
      navigate("/account/profile", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Could not change password."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full bg-sap-surface">
      <div className="mx-auto w-full max-w-[760px] px-6 py-8">
        <Button
          variant="ghost"
          className="-ml-3 mb-4"
          render={<Link to="/account/profile" />}
        >
          <ArrowLeft data-icon="inline-start" />
          Back to profile
        </Button>

        <header className="mb-7 flex items-start gap-3">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-[7px] bg-sap-active-nav text-sap-brand">
            <KeyRound className="size-5" strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <h1 className="text-[22px] font-[680] leading-tight text-sap-fg">
              Change password
            </h1>
            <p className="mt-1 text-sap-body text-sap-muted">
              Enter your current password, then choose a new one.
            </p>
          </div>
        </header>

        <form className="flex max-w-[420px] flex-col gap-5" onSubmit={submit}>
          <PasswordField
            label="Current password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoFocus
          />
          <PasswordField
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={setNewPassword}
          />
          <PasswordField
            label="Confirm new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />

          {error ? (
            <p className="text-sap-body text-sap-negative" role="alert">
              {error}
            </p>
          ) : null}

          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Changing password..." : "Change password"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={autoFocus}
        required
      />
    </div>
  );
}
