import type { SapportaMailer } from "../mailer.js";
import type Mail from "nodemailer/lib/mailer/index.js";

interface AuthEmailUser {
  email: string;
  name?: string | null;
}

interface AuthLinkEmail {
  user: AuthEmailUser;
  url: string;
  token: string;
}

export async function sendVerificationEmail(
  mailer: SapportaMailer,
  data: AuthLinkEmail,
): Promise<void> {
  await mailer.sendMail(buildVerificationEmail(data, mailer.defaults.from));
}

export function buildVerificationEmail(
  data: AuthLinkEmail,
  from: string,
): Mail.Options {
  const displayName = data.user.name ?? data.user.email;
  const verificationUrl = frontendVerificationUrl(data.url);
  return {
    from,
    to: data.user.email,
    subject: "Verify your email",
    text: [
      `Hi ${displayName},`,
      "",
      "Verify your email address to finish setting up your account:",
      verificationUrl,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(displayName)},</p>`,
      "<p>Verify your email address to finish setting up your account.</p>",
      `<p><a href="${escapeHtml(verificationUrl)}">Verify email</a></p>`,
      "<p>If you did not request this, you can ignore this email.</p>",
    ].join("\n"),
  };
}

export async function sendPasswordResetEmail(
  mailer: SapportaMailer,
  data: AuthLinkEmail,
): Promise<void> {
  await mailer.sendMail(buildPasswordResetEmail(data, mailer.defaults.from));
}

export function buildPasswordResetEmail(
  data: AuthLinkEmail,
  from: string,
): Mail.Options {
  const displayName = data.user.name ?? data.user.email;
  return {
    from,
    to: data.user.email,
    subject: "Reset your password",
    text: [
      `Hi ${displayName},`,
      "",
      "Reset your password using this link:",
      data.url,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: [
      `<p>Hi ${escapeHtml(displayName)},</p>`,
      "<p>Reset your password using this link.</p>",
      `<p><a href="${escapeHtml(data.url)}">Reset password</a></p>`,
      "<p>If you did not request this, you can ignore this email.</p>",
    ].join("\n"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function frontendVerificationUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const token = url.searchParams.get("token");
    if (!token) return rawUrl;

    const frontendUrl = new URL("/verify-email", url.origin);
    frontendUrl.searchParams.set("token", token);
    frontendUrl.searchParams.set(
      "next",
      url.searchParams.get("callbackURL") ?? "/",
    );
    return frontendUrl.toString();
  } catch {
    return rawUrl;
  }
}
