import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Button, Input, Label } from "@sapporta/ui";
import { getApiBase } from "@/platform/base";
import { useAuthStore } from "@/auth/state/auth-store";

type AuthMode = "login" | "signup" | "forgot" | "reset";
type VerifyEmailLocationState = { email?: string };

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
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refresh = useAuthStore((s) => s.refresh);
  const contextEmail = useAuthStore((s) => s.context?.user.email);
  const stateEmail = readVerifyEmailState(location.state).email;
  const token = searchParams.get("token");
  const next = safeRedirectPath(searchParams.get("next"));
  const isResend = searchParams.get("resend") === "1";
  const [email, setEmail] = useState(stateEmail ?? contextEmail ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function verify() {
      setSubmitting(true);
      setMessage(null);
      setError(null);
      try {
        const params = new URLSearchParams({ token: token ?? "" });
        const res = await fetch(`${getApiBase()}/auth/verify-email?${params}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(await responseMessage(res));
        await refresh();
        if (cancelled) return;
        setMessage("Email verified. Taking you back...");
        window.setTimeout(() => {
          if (!cancelled) navigate(next, { replace: true });
        }, 1200);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [navigate, next, refresh, token]);

  async function resend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/auth/send-verification-email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, callbackURL: next }),
      });
      if (!res.ok) throw new Error(await responseMessage(res));
      setMessage("Verification email sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthFrame title="Verify email">
      <p className="text-sm text-sap-muted">
        {token
          ? "Confirming your email address."
          : "We've sent a confirmation link to your email. Click it to verify your account and continue."}
      </p>
      {message && <div className="text-sm text-sap-positive">{message}</div>}
      {error && <div className="text-sm text-sap-negative">{error}</div>}
      {!token && !isResend && (
        <div className="flex flex-col gap-3">
          <Link
            className="text-sm"
            to="/verify-email?resend=1"
            state={{ email }}
          >
            Didn't get a verification email?
          </Link>
          <Link className="text-sm" to="/login">
            Back to login
          </Link>
        </div>
      )}
      {!token && isResend && (
        <>
          <p className="text-sm text-sap-muted">
            Enter your email address and we'll send another confirmation link.
          </p>
          <form onSubmit={resend} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Sending..." : "Resend verification email"}
            </Button>
          </form>
          <Link className="text-sm" to="/verify-email" state={{ email }}>
            Back
          </Link>
        </>
      )}
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
      if (!res.ok) {
        const failure = await responseFailure(res);
        if (mode === "login" && failure.code === "EMAIL_NOT_VERIFIED") {
          navigate("/verify-email", { replace: true, state: { email } });
          return;
        }
        throw new Error(failure.message);
      }
      if (mode === "forgot") {
        navigate("/login", { replace: true });
        return;
      }
      await refresh();
      if (mode === "signup") {
        navigate("/verify-email", { replace: true, state: { email } });
        return;
      }
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

function readVerifyEmailState(value: unknown): VerifyEmailLocationState {
  if (!value || typeof value !== "object") return {};
  const email = "email" in value ? value.email : undefined;
  return typeof email === "string" ? { email } : {};
}

function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
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
  return (await responseFailure(res)).message;
}

async function responseFailure(
  res: Response,
): Promise<{ message: string; code?: string }> {
  try {
    const body = (await res.json()) as {
      code?: string;
      error?: string;
      message?: string;
    };
    return {
      code: body.code,
      message: body.error ?? body.message ?? res.statusText,
    };
  } catch {
    return { message: res.statusText };
  }
}
