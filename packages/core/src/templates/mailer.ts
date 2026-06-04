import nodemailer, { type SentMessageInfo, type Transporter } from "nodemailer";
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

  const sentMessage: Mail.Options = {
    from: defaults.from,
    ...message,
  };
  const info = await transport.sendMail(sentMessage);

  if (defaults.transport === "stream") {
    logStreamMessage(sentMessage);
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

function logStreamMessage(message: Mail.Options): void {
  console.log(
    [
      "\n[sapporta mail] generated email",
      `From: ${formatAddressLog(message.from)}`,
      `To: ${formatAddressLog(message.to)}`,
      message.subject ? `Subject: ${message.subject}` : undefined,
      formatBodyPart("Text", message.text),
      formatBodyPart("HTML", message.html),
    ]
      .filter((part): part is string => part !== undefined)
      .join("\n\n"),
  );
}

function formatBodyPart(
  label: string,
  value: Mail.Options["text"],
): string | undefined {
  const body = formatBodyValue(value);
  return body === undefined ? undefined : `${label}:\n${body}`;
}

function formatBodyValue(value: Mail.Options["text"]): string | undefined {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return undefined;
}

function formatAddressLog(value: Mail.Options["to"]): string {
  if (value === undefined) return "(no recipient)";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatAddressLog).join(", ");
  if ("address" in value) return value.address;
  return String(value);
}
