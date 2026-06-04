import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input, Label } from "@sapporta/ui";
import { getApiBase } from "@/platform/base";
import { useAuthStore } from "@/auth/state/auth-store";

type AuthMode = "login" | "signup" | "forgot" | "reset";

export function LoginPage() {
  return (
    <EmailPasswordPage
      mode="login"
      title="Log in"
      endpoint="/auth/sign-in/email"
    />
  );
}

export function SignupPage() {
  return (
    <EmailPasswordPage
      mode="signup"
      title="Sign up"
      endpoint="/auth/sign-up/email"
      note="You are creating a new workspace and will be its owner."
    />
  );
}

export function ForgotPasswordPage() {
  return (
    <EmailPasswordPage
      mode="forgot"
      title="Reset password"
      endpoint="/auth/request-password-reset"
    />
  );
}

export function ResetPasswordPage() {
  return (
    <EmailPasswordPage
      mode="reset"
      title="Set new password"
      endpoint="/auth/reset-password"
    />
  );
}

export function VerifyEmailPage() {
  return (
    <AuthFrame title="Verify email">
      <p className="text-sm text-sap-muted">
        Check your email for a verification link, then return here.
      </p>
      <Button onClick={() => void useAuthStore.getState().refresh()}>
        I verified my email
      </Button>
    </AuthFrame>
  );
}

function EmailPasswordPage({
  mode,
  title,
  endpoint,
  note,
}: {
  mode: AuthMode;
  title: string;
  endpoint: string;
  note?: string;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refresh = useAuthStore((s) => s.refresh);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const resetToken = searchParams.get("token");
      if (mode === "reset" && !resetToken) {
        throw new Error("Password reset link is missing a token.");
      }
      const res = await fetch(`${getApiBase()}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          bodyForMode(mode, { email, password, name, resetToken }),
        ),
      });
      if (!res.ok) throw new Error(await responseMessage(res));
      if (mode === "forgot") {
        navigate("/login", { replace: true });
        return;
      }
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthFrame title={title}>
      <form onSubmit={submit} className="space-y-4">
        {note && <p className="text-sm text-sap-muted">{note}</p>}
        {mode === "signup" && (
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        {mode !== "reset" && (
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
        )}
        {mode !== "forgot" && (
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        )}
        {error && <div className="text-sm text-sap-negative">{error}</div>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Working..." : title}
        </Button>
      </form>
      <AuthLinks mode={mode} />
    </AuthFrame>
  );
}

function AuthFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sap-bg px-4">
      <div className="w-full max-w-[360px] space-y-5">
        <h1 className="text-xl font-semibold text-sap-fg">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function AuthLinks({ mode }: { mode: AuthMode }) {
  if (mode === "login") {
    return (
      <div className="flex justify-between text-sm">
        <Link to="/signup">Sign up</Link>
        <Link to="/forgot-password">Forgot password</Link>
      </div>
    );
  }
  return (
    <div className="text-sm">
      <Link to="/login">Back to login</Link>
    </div>
  );
}

function bodyForMode(
  mode: AuthMode,
  fields: {
    email: string;
    password: string;
    name: string;
    resetToken: string | null;
  },
): Record<string, string> {
  if (mode === "signup") {
    return {
      email: fields.email,
      password: fields.password,
      name: fields.name,
      callbackURL: "/",
    };
  }
  if (mode === "forgot") {
    return { email: fields.email, redirectTo: "/reset-password" };
  }
  if (mode === "reset") {
    return { newPassword: fields.password, token: fields.resetToken ?? "" };
  }
  return { email: fields.email, password: fields.password };
}

async function responseMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return body.error ?? body.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
