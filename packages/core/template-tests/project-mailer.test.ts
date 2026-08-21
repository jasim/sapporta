import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer/index.js";
import { readSmtpOptions, sendMailWith } from "../src/templates/packages/api/mailer.js";
import { readProjectAuthEnv } from "../src/templates/packages/api/project-auth/env.js";
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
} from "../src/templates/packages/api/project-auth/emails.js";

describe("project mailer template", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("parses stream mail defaults", () => {
    expect(readProjectAuthEnv(authEnv()).mail).toEqual({
      from: "Sapporta <no-reply@example.test>",
      transport: "stream",
    });
  });

  it("parses SMTP URL config", () => {
    const env = readProjectAuthEnv(
      authEnv({
        SAPPORTA_MAIL_TRANSPORT: "smtp",
        SMTP_URL: "smtp://user:pass@smtp.example.test:587",
      }),
    );

    expect(env.mail).toEqual({
      from: "Sapporta <no-reply@example.test>",
      transport: "smtp",
      smtp: { url: "smtp://user:pass@smtp.example.test:587" },
    });
    if (env.mail.transport !== "smtp") {
      throw new Error("expected SMTP mail config");
    }
    expect(readSmtpOptions(env.mail.smtp)).toBe(
      "smtp://user:pass@smtp.example.test:587",
    );
  });

  it("parses SMTP host config", () => {
    const env = readProjectAuthEnv(
      authEnv({
        SAPPORTA_MAIL_TRANSPORT: "smtp",
        SMTP_HOST: "smtp.example.test",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "user",
        SMTP_PASS: "pass",
      }),
    );

    expect(env.mail).toEqual({
      from: "Sapporta <no-reply@example.test>",
      transport: "smtp",
      smtp: {
        host: "smtp.example.test",
        port: 465,
        secure: true,
        auth: { user: "user", pass: "pass" },
      },
    });
    if (env.mail.transport !== "smtp") {
      throw new Error("expected SMTP mail config");
    }
    expect(readSmtpOptions(env.mail.smtp)).toEqual({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      auth: { user: "user", pass: "pass" },
    });
  });

  it("rejects malformed mail env values", () => {
    expect(() =>
      readProjectAuthEnv(
        authEnv({
          SAPPORTA_MAIL_TRANSPORT: "console",
        }),
      ),
    ).toThrow(/SAPPORTA_MAIL_TRANSPORT/);

    expect(() =>
      readProjectAuthEnv(
        authEnv({
          SAPPORTA_MAIL_TRANSPORT: "smtp",
          SMTP_HOST: "smtp.example.test",
          SMTP_PORT: "587x",
        }),
      ),
    ).toThrow(/SMTP_PORT/);

    expect(() =>
      readProjectAuthEnv(
        authEnv({
          SAPPORTA_MAIL_TRANSPORT: "smtp",
          SMTP_HOST: "smtp.example.test",
          SMTP_PORT: "587",
          SMTP_SECURE: "yes",
        }),
      ),
    ).toThrow(/SMTP_SECURE/);
  });

  it("adds the default sender and logs generated stream messages", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const sentMessages: Mail.Options[] = [];
    const transport = {
      sendMail: vi.fn(async (message: Mail.Options) => {
        sentMessages.push(message);
        return {
          accepted: ["owner@example.test"],
          rejected: [],
          message: Buffer.from("raw generated email source"),
        };
      }),
    } as unknown as Transporter;

    const info = await sendMailWith(
      transport,
      {
        from: "Sapporta <no-reply@example.test>",
        transport: "stream",
      },
      {
        to: "owner@example.test",
        subject: "Custom domain email",
        text: [
          "This body came from a custom route.",
          "http://localhost:5173/api/auth/verify-email?token=verify-token&callbackURL=http%3A%2F%2Flocalhost%3A5173%2F",
        ].join("\n"),
      },
    );

    expect(info).toMatchObject({ accepted: ["owner@example.test"] });
    expect(sentMessages).toEqual([
      {
        from: "Sapporta <no-reply@example.test>",
        to: "owner@example.test",
        subject: "Custom domain email",
        text: [
          "This body came from a custom route.",
          "http://localhost:5173/api/auth/verify-email?token=verify-token&callbackURL=http%3A%2F%2Flocalhost%3A5173%2F",
        ].join("\n"),
      },
    ]);
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "http://localhost:5173/api/auth/verify-email?token=verify-token&callbackURL=http%3A%2F%2Flocalhost%3A5173%2F",
      ),
    );
    expect(consoleLog).not.toHaveBeenCalledWith(
      expect.stringContaining("raw generated email source"),
    );
  });

  it("does not call the transport when delivery is disabled", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const sendMail = vi.fn();
    const transport = { sendMail } as unknown as Transporter;

    const info = await sendMailWith(
      transport,
      {
        from: "Sapporta <no-reply@example.test>",
        transport: "disabled",
      },
      {
        to: "owner@example.test",
        subject: "Skipped",
        text: "This should not be delivered.",
      },
    );

    expect(sendMail).not.toHaveBeenCalled();
    expect(info).toMatchObject({ accepted: [], rejected: [] });
  });

  it("composes Better Auth email bodies with callback URLs and escaped HTML", () => {
    const verification = buildVerificationEmail(
      {
        user: { email: "owner@example.test", name: "<Owner & Co>" },
        url: "http://localhost:3000/api/auth/verify-email?token=verify-token&callbackURL=%2F",
        token: "verify-token",
      },
      "Sapporta <no-reply@example.test>",
    );
    const reset = buildPasswordResetEmail(
      {
        user: { email: "owner@example.test", name: "Owner" },
        url: "http://localhost:3000/api/auth/reset-password/reset-token",
        token: "reset-token",
      },
      "Sapporta <no-reply@example.test>",
    );

    expect(verification).toMatchObject({
      from: "Sapporta <no-reply@example.test>",
      to: "owner@example.test",
      subject: "Verify your email",
    });
    expect(verification.text).toContain(
      "http://localhost:3000/verify-email?token=verify-token&next=%2F",
    );
    expect(verification.html).toContain("&lt;Owner &amp; Co&gt;");
    expect(verification.html).not.toContain("<Owner & Co>");
    expect(reset).toMatchObject({
      subject: "Reset your password",
      to: "owner@example.test",
    });
    expect(reset.text).toContain("reset-token");
  });
});

function authEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    BETTER_AUTH_SECRET: "secret",
    SAPPORTA_PUBLIC_APP_URL: "http://localhost:5173",
    SAPPORTA_MAIL_TRANSPORT: "stream",
    SAPPORTA_MAIL_FROM: "Sapporta <no-reply@example.test>",
    ...overrides,
  };
}
