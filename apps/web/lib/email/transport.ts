/**
 * Email transport — nodemailer over SMTP.
 *
 * Provider-agnostic (any SMTP works from Russia). Config comes from env; when
 * absent the module degrades gracefully (`isEmailConfigured()` is false and
 * sends are a typed no-op) so the rest of the product keeps working.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

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

export type TestEmailOutboxEntry = EmailMessage & {
  sequence: number;
};

type EmailEnvironment = Readonly<Record<string, string | undefined>>;

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  replyTo: string | null;
  secure: boolean;
};

function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const portRaw = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const replyTo = process.env.SMTP_REPLY_TO?.trim() || null;

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
    replyTo,
    // Implicit TLS on 465; STARTTLS upgrade on 587/25.
    secure: port === 465,
  };
}

/** Whether SMTP is configured (all required env vars present and valid). */
export function isEmailConfigured(): boolean {
  if (process.env.AUTH_EMAIL_TRANSPORT === "test") {
    return resolveTestEmailOutboxPath() !== null;
  }
  return resolveTestEmailOutboxPath() !== null || readSmtpConfig() !== null;
}

/** The configured From address, or null when email is not configured. */
export function getEmailFromAddress(): string | null {
  return readSmtpConfig()?.from ?? null;
}

let cachedTransporter: Transporter | null = null;
let testOutboxWriteQueue: Promise<void> = Promise.resolve();

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
  const testOutboxPath = resolveTestEmailOutboxPath();
  if (
    process.env.AUTH_EMAIL_TRANSPORT === "test"
    && !testOutboxPath
  ) {
    return { ok: false, reason: "not_configured" };
  }
  if (testOutboxPath) {
    try {
      await enqueueTestEmail(testOutboxPath, message);
      logEvent("email.test_outbox_recorded", {
        to: redactEmail(message.to),
        subject: message.subject,
      });
      return { ok: true };
    } catch (error) {
      logError("email.test_outbox_failed", error, {
        to: redactEmail(message.to),
      });
      return {
        ok: false,
        reason: "send_failed",
        error: error instanceof Error ? error.message : "unknown",
      };
    }
  }

  const config = readSmtpConfig();
  if (!config) {
    return { ok: false, reason: "not_configured" };
  }

  try {
    const transporter = getTransporter(config);
    await transporter.sendMail({
      from: config.from,
      replyTo: config.replyTo ?? undefined,
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

export async function readTestEmailOutbox(
  filePath = process.env.AUTH_EMAIL_TEST_OUTBOX_PATH?.trim() ?? "",
): Promise<TestEmailOutboxEntry[]> {
  if (!isAbsolute(filePath)) {
    throw new Error("AUTH_EMAIL_TEST_OUTBOX_PATH must be absolute.");
  }
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("Auth email test outbox must contain an array.");
    }
    return parsed.map((entry, index) => parseTestOutboxEntry(entry, index));
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

export function resolveTestEmailOutboxPath(
  env: EmailEnvironment = process.env,
): string | null {
  if (
    env.AUTH_EMAIL_TRANSPORT !== "test"
    || env.NODE_ENV === "production"
  ) {
    return null;
  }
  const filePath = env.AUTH_EMAIL_TEST_OUTBOX_PATH?.trim() ?? "";
  return isAbsolute(filePath) ? filePath : null;
}

async function enqueueTestEmail(
  filePath: string,
  message: EmailMessage,
): Promise<void> {
  const write = testOutboxWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const existing = await readTestEmailOutbox(filePath);
      const next: TestEmailOutboxEntry = {
        sequence: existing.length + 1,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      };
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        `${JSON.stringify([...existing, next], null, 2)}\n`,
        { encoding: "utf8", flag: "w" },
      );
    });
  testOutboxWriteQueue = write;
  await write;
}

function parseTestOutboxEntry(
  value: unknown,
  index: number,
): TestEmailOutboxEntry {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid auth email test outbox entry at index ${index}.`);
  }
  const entry = value as Partial<TestEmailOutboxEntry>;
  if (
    !Number.isInteger(entry.sequence)
    || typeof entry.to !== "string"
    || typeof entry.subject !== "string"
    || typeof entry.html !== "string"
    || typeof entry.text !== "string"
  ) {
    throw new Error(`Invalid auth email test outbox entry at index ${index}.`);
  }
  return entry as TestEmailOutboxEntry;
}

/** Redacts an address for logs: `john@example.com` → `j***@example.com`. */
function redactEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 1) return "***";
  return `${value[0]}***${value.slice(at)}`;
}
