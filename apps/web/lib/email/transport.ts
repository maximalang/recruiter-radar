/**
 * Email transport — nodemailer over SMTP.
 *
 * Provider-agnostic (any SMTP works from Russia). Config comes from env; when
 * absent the module degrades gracefully (`isEmailConfigured()` is false and
 * sends are a typed no-op) so the rest of the product keeps working.
 */

import nodemailer, { type Transporter } from "nodemailer";

import { logError, logEvent } from "../runtime";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback for clients that do not render HTML. */
  text: string;
};

export type SendEmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "send_failed"; error?: string };

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
};

function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim();

  if (!host || !portRaw || !user || !pass || !from) {
    return null;
  }

  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  return {
    host,
    port,
    user,
    pass,
    from,
    // Implicit TLS on 465; STARTTLS upgrade on 587/25.
    secure: port === 465,
  };
}

/** Whether SMTP is configured (all required env vars present and valid). */
export function isEmailConfigured(): boolean {
  return readSmtpConfig() !== null;
}

/** The configured From address, or null when email is not configured. */
export function getEmailFromAddress(): string | null {
  return readSmtpConfig()?.from ?? null;
}

let cachedTransporter: Transporter | null = null;

function getTransporter(config: SmtpConfig): Transporter {
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
  return cachedTransporter;
}

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const config = readSmtpConfig();
  if (!config) {
    return { ok: false, reason: "not_configured" };
  }

  try {
    const transporter = getTransporter(config);
    await transporter.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    logEvent("email.sent", { to: redactEmail(message.to), subject: message.subject });
    return { ok: true };
  } catch (error) {
    logError("email.send_failed", error, { to: redactEmail(message.to) });
    return { ok: false, reason: "send_failed", error: error instanceof Error ? error.message : "unknown" };
  }
}

/** Redacts an address for logs: `john@example.com` → `j***@example.com`. */
function redactEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 1) return "***";
  return `${value[0]}***${value.slice(at)}`;
}
