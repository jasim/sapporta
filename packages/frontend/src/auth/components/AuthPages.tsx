import {
  cloneElement,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Button } from "@sapporta/ui/button";
import { Input } from "@sapporta/ui/input";
import { Label } from "@sapporta/ui/label";
import { getApiBase } from "../../platform/base";
import { useAuthStore } from "../state/auth-store";
import { loadProjectInfo } from "../../schema-catalog/actions/metadata";
import { useSchemaStore } from "../../schema-catalog/state/schema-store";

type AuthMode = "login" | "signup" | "forgot" | "reset";
type VerifyEmailLocationState = { email?: string };
type ModeContent = {
  title: string;
  intro: string;
  submit: string;
  submitting: string;
  endpoint: string;
};

const MODE_CONTENT: Record<AuthMode, ModeContent> = {
  login: {
    title: "Sign in",
    intro: "Use your email and password to continue.",
    submit: "Sign in",
    submitting: "Signing in...",
    endpoint: "/auth/sign-in/email",
  },
  signup: {
    title: "Sign up and create your first workspace",
    intro: "Enter your details to get started.",
    submit: "Create account",
    submitting: "Creating account...",
    endpoint: "/auth/sign-up/email",
  },
  forgot: {
    title: "Reset your password",
    intro:
      "Enter your email and we'll send a reset link if there is an account for it.",
    submit: "Send reset link",
    submitting: "Sending...",
    endpoint: "/auth/request-password-reset",
  },
  reset: {
    title: "Choose a new password",
    intro: "Enter a new password for your account.",
    submit: "Update password",
    submitting: "Updating...",
    endpoint: "/auth/reset-password",
  },
};

export function LoginPage() {
  return <EmailPasswordPage mode="login" />;
}

export function SignupPage() {
  return <EmailPasswordPage mode="signup" />;
}

export function ForgotPasswordPage() {
  return <EmailPasswordPage mode="forgot" />;
}

export function ResetPasswordPage() {
  return <EmailPasswordPage mode="reset" />;
}

export function VerifyEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reloadSession = useAuthStore((s) => s.reloadSession);
  const session = useAuthStore((s) => s.session);
  const contextEmail =
    session.kind === "authenticated" ? session.context.user.email : undefined;
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
        await reloadSession();
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
  }, [navigate, next, reloadSession, token]);

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
      setMessage("Verification email sent. Check your inbox for the new link.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthFrame title="Verify your email">
      <p className="text-sm text-sap-muted">
        {token
          ? "Confirming your email address."
          : "Check your inbox for a verification link. The link will sign you in, so you can close this tab."}
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
            Back to sign in
          </Link>
        </div>
      )}
      {!token && isResend && (
        <>
          <p className="text-sm text-sap-muted">
            Enter your email and we'll send another verification link.
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
      {!token && import.meta.env.DEV && (
        <div
          role="note"
          className="rounded-lg border border-sap-warning/40 bg-sap-warning/10 p-3 text-sm font-medium text-sap-warning"
        >
          Development mode: Check the development server logs for the email
          verification link.
        </div>
      )}
    </AuthFrame>
  );
}

function EmailPasswordPage({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reloadSession = useAuthStore((s) => s.reloadSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const content = MODE_CONTENT[mode];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const resetToken = searchParams.get("token");
      if (mode === "reset" && !resetToken) {
        throw new Error("Password reset link is missing a token.");
      }
      const res = await fetch(`${getApiBase()}${content.endpoint}`, {
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
        setMessage(
          "If an account exists for that email, a reset link is on the way.",
        );
        return;
      }
      await reloadSession();
      if (mode === "signup") {
        navigate("/verify-email", { replace: true, state: { email } });
        return;
      }
      if (mode === "reset") {
        setMessage("Password updated. Taking you to sign in...");
        window.setTimeout(() => navigate("/login", { replace: true }), 900);
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
    <AuthFrame title={content.title}>
      <p className="text-sm text-sap-muted">{content.intro}</p>
      <form onSubmit={submit} className="space-y-4">
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
        {message && <div className="text-sm text-sap-positive">{message}</div>}
        {error && <div className="text-sm text-sap-negative">{error}</div>}
        <Button type="submit" disabled={submitting}>
          {submitting ? content.submitting : content.submit}
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
  const name = useProjectName();

  return (
    <div className="flex min-h-screen items-center justify-center bg-sap-bg px-4">
      <div className="w-full max-w-[360px] space-y-5">
        <div className="space-y-1">
          <div className="text-sm font-medium text-sap-muted">{name ?? ""}</div>
          <h1 className="text-xl font-semibold text-sap-fg">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ id?: string }>;
}) {
  const generatedId = useId();
  const id = children.props.id ?? generatedId;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children, { id })}
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
        <Link to="/signup">Create account</Link>
        <Link to="/forgot-password">Reset password</Link>
      </div>
    );
  }
  return (
    <div className="text-sm">
      <Link to="/login">Back to sign in</Link>
    </div>
  );
}

function useProjectName(): string | null {
  const name = useSchemaStore((s) => s.name);

  useEffect(() => {
    if (name) return;
    void loadProjectInfo().catch(() => undefined);
  }, [name]);

  return name;
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
