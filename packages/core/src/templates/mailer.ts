import nodemailer, {
  type SentMessageInfo,
  type Transporter,
} from "nodemailer";
import type Mail from "nodemailer/lib/mailer/index.js";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import type {
  MailTransportKind,
  ProjectMailConfig,
  ProjectSmtpConfig,
} from "./project-auth/env.js";

export interface MailDefaults {
  from: string;
  transport: MailTransportKind;
}

export interface SapportaMailer {
  defaults: MailDefaults;
  transport: Transporter;
  sendMail: (message: Mail.Options) => Promise<SentMessageInfo>;
}

export function createSapportaMailer(
  config: ProjectMailConfig,
): SapportaMailer {
  const defaults = {
    from: config.from,
    transport: config.transport,
  };
  const transport = createMailTransport(config);
  return {
    defaults,
    transport,
    sendMail: (message) => sendMailWith(transport, defaults, message),
  };
}

export async function sendMailWith(
  transport: Transporter,
  defaults: MailDefaults,
  message: Mail.Options,
): Promise<SentMessageInfo> {
  if (defaults.transport === "disabled") {
    console.log(
      `[sapporta mail] delivery disabled; skipped message to ${formatAddressLog(message.to)}`,
    );
    return { accepted: [], rejected: [], response: "disabled" };
  }

  const info = await transport.sendMail({
    from: defaults.from,
    ...message,
  });

  if (defaults.transport === "stream") {
    logStreamMessage(info);
  }

  return info;
}

export function createMailTransport(config: ProjectMailConfig): Transporter {
  switch (config.transport) {
    case "stream":
    case "disabled":
      return nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
        newline: "unix",
      });
    case "smtp":
      return nodemailer.createTransport(readSmtpOptions(config.smtp));
  }
}

export function readSmtpOptions(
  smtp: ProjectSmtpConfig,
): SMTPTransport.Options | string {
  if ("url" in smtp) return smtp.url;

  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.auth,
  };
}

function logStreamMessage(info: SentMessageInfo): void {
  const message = readGeneratedMessage(info);
  if (message === undefined) return;
  console.log("\n[sapporta mail] generated email\n" + message);
}

function readGeneratedMessage(info: SentMessageInfo): string | undefined {
  if (typeof info !== "object" || info === null || !("message" in info)) {
    return undefined;
  }

  const message = info.message;
  if (Buffer.isBuffer(message)) return message.toString("utf8");
  if (typeof message === "string") return message;
  return undefined;
}

function formatAddressLog(value: Mail.Options["to"]): string {
  if (value === undefined) return "(no recipient)";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatAddressLog).join(", ");
  if ("address" in value) return value.address;
  return String(value);
}
