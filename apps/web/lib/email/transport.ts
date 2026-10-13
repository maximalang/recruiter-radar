/**
 * Email transport — Yandex Cloud Postbox over HTTPS, with SMTP fallback.
 *
 * Provider-agnostic (any SMTP works from Russia). Config comes from env; when
 * absent the module degrades gracefully (`isEmailConfigured()` is false and
 * sends are a typed no-op) so the rest of the product keeps working.
 *
 * Message boundary: every caller passes one plain `user@domain` address plus
 * branded HTML/text rendered in-process. Structured recipient arrays, display
 * names, RFC 5322 comments/groups, quoted local parts, file/URL content and
 * attachments are refused before the transport sees them (see
 * `validateEmailMessage`). The SMTP transport additionally disables file and
 * URL access and states its TLS identity explicitly.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

import nodemailer, { type Transporter } from "nodemailer";

import { logError, logEvent } from "../runtime";
import { recordSuccessfulEmailDelivery } from "./delivery-health";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback for clients that do not render HTML. */
  text: string;
};

/**
 * Why a message was refused before it reached a provider. Kept distinct from
 * `send_failed` so a caller can tell "we refused to send this" apart from "the
 * provider refused the send".
 */
export type EmailMessageRejection = "invalid_recipient" | "invalid_message";

export type SendEmailResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "send_failed" | EmailMessageRejection };

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

type PostboxConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
  from: string;
  replyTo: string | null;
  timeoutMs: number;
};

/**
 * Message boundary ceilings. The auth and digest senders only ever emit one
 * plain address and a small branded body, so anything beyond these limits is a
 * bug or an injection attempt and is refused before reaching the transport.
 */
const MAX_RECIPIENTS = 20;
const MAX_RECIPIENT_LENGTH = 254;
const MAX_RECIPIENT_LIST_LENGTH = 1000;
const MAX_SUBJECT_LENGTH = 300;
const MAX_BODY_LENGTH = 512 * 1024;

/**
 * SMTP timeouts. Without them a stalled peer holds the send open until a
 * platform-level timeout, and the resulting failure category is ambiguous.
 */
const SMTP_CONNECTION_TIMEOUT_MS = 15_000;
const SMTP_GREETING_TIMEOUT_MS = 15_000;
const SMTP_SOCKET_TIMEOUT_MS = 30_000;

const RECIPIENT_LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const RECIPIENT_DOMAIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const HOSTNAME_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/** CR, LF, NUL and friends: the classic header-injection vector. */
function hasControlCharacters(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Parses one or more plain `user@domain` addresses out of the caller's `to`.
 *
 * Deliberately strict: display names, RFC 5322 comments, groups, quoted local
 * parts and structured recipient arrays are refused instead of being handed to
 * the address parser. Those are exactly the forms the parser advisories abuse
 * (quadratic parsing, depth-limit bypass, comment mis-parsing, IDN allow-list
 * bypass), and every caller in this codebase passes one plain address.
 */
function parseRecipientList(to: unknown): string[] | null {
  if (typeof to !== "string") return null;
  const raw = to.trim();
  if (raw.length === 0 || raw.length > MAX_RECIPIENT_LIST_LENGTH) return null;
  const parts = raw.split(",");
  if (parts.length === 0 || parts.length > MAX_RECIPIENTS) return null;

  const addresses: string[] = [];
  for (const part of parts) {
    const address = part.trim();
    if (
      address.length === 0
      || address.length > MAX_RECIPIENT_LENGTH
      || hasControlCharacters(address)
      || /\s/.test(address)
    ) {
      return null;
    }
    const at = address.lastIndexOf("@");
    if (at <= 0 || at === address.length - 1) return null;
    const local = address.slice(0, at);
    const domain = address.slice(at + 1);
    if (
      !RECIPIENT_LOCAL_PART.test(local)
      || local.startsWith(".")
      || local.endsWith(".")
      || local.includes("..")
      || !RECIPIENT_DOMAIN.test(domain)
    ) {
      return null;
    }
    addresses.push(address);
  }
  return addresses;
}

/**
 * Fail-closed validation of everything the transport accepts from callers.
 *
 * Returns the canonical recipient list, or the rejection reason that is safe to
 * log (no address, subject or body content is included).
 */
export function validateEmailMessage(
  message: EmailMessage,
): { recipients: string[] } | { rejection: EmailMessageRejection } {
  if (!message || typeof message !== "object") {
    return { rejection: "invalid_message" };
  }
  const recipients = parseRecipientList(message.to);
  if (!recipients) return { rejection: "invalid_recipient" };
  if (
    typeof message.subject !== "string"
    || message.subject.length > MAX_SUBJECT_LENGTH
    || hasControlCharacters(message.subject)
  ) {
    return { rejection: "invalid_message" };
  }
  if (typeof message.html !== "string" || typeof message.text !== "string") {
    return { rejection: "invalid_message" };
  }
  if (message.html.length + message.text.length > MAX_BODY_LENGTH) {
    return { rejection: "invalid_message" };
  }
  return { recipients };
}

/**
 * Explicit TLS identity used for SNI and peer-certificate verification.
 *
 * Nodemailer keeps a process-global DNS cache keyed only by host while the
 * cached entry also stores the caller's `servername`, so a later transport on
 * the same host could verify the peer against another transport's name
 * (GHSA-6vj9-mwq6-2f5v). Stating `tls.servername` explicitly keeps the value
 * independent of that cache. IP hosts and malformed values are skipped, which
 * leaves Node verifying against the host itself.
 */
function resolveSmtpTlsServername(host: string): string | null {
  const candidate = (process.env.SMTP_TLS_SERVERNAME?.trim() || host).trim();
  if (candidate.length === 0 || candidate.length > 253) return null;
  if (isIP(candidate) !== 0) return null;
  if (hasControlCharacters(candidate) || /\s/.test(candidate)) return null;
  return HOSTNAME_LABEL.test(candidate) ? candidate : null;
}

function readPostboxConfig(): PostboxConfig | null {
  const accessKeyId = process.env.POSTBOX_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.POSTBOX_SECRET_ACCESS_KEY?.trim();
  const from = process.env.POSTBOX_FROM?.trim();
  const endpoint = (process.env.POSTBOX_ENDPOINT?.trim()
    || "https://postbox.cloud.yandex.net").replace(/\/+$/, "");
  const region = process.env.POSTBOX_REGION?.trim() || "ru-central1";
  const replyTo = process.env.POSTBOX_REPLY_TO?.trim() || null;
  const timeoutRaw = process.env.POSTBOX_TIMEOUT_MS?.trim() || "10000";
  const timeoutMs = Number(timeoutRaw);

  if (
    !accessKeyId
    || !secretAccessKey
    || !from
    || !endpoint.startsWith("https://")
    || !region
    || !Number.isInteger(timeoutMs)
    || timeoutMs < 1000
    || timeoutMs > 60000
  ) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    region,
    from,
    replyTo,
    timeoutMs,
  };
}

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
  return resolveTestEmailOutboxPath() !== null
    || readPostboxConfig() !== null
    || readSmtpConfig() !== null;
}

/** The configured From address, or null when email is not configured. */
export function getEmailFromAddress(): string | null {
  return readPostboxConfig()?.from ?? readSmtpConfig()?.from ?? null;
}

let cachedTransporter: Transporter | null = null;
let testOutboxWriteQueue: Promise<void> = Promise.resolve();

function getTransporter(config: SmtpConfig): Transporter {
  if (cachedTransporter) return cachedTransporter;
  const servername = resolveSmtpTlsServername(config.host);
  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // Never resolve a file path or URL out of message data, and keep the TLS
    // identity explicit instead of inheriting it from the shared DNS cache.
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(servername ? { tls: { servername } } : {}),
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
  });
  return cachedTransporter;
}

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const validation = validateEmailMessage(message);
  if ("rejection" in validation) {
    logEvent("email.message_rejected", {
      failureCategory: "message_boundary",
      rejection: validation.rejection,
    });
    return { ok: false, reason: validation.rejection };
  }
  const recipients = validation.recipients;
  const testOutboxPath = resolveTestEmailOutboxPath();
  if (
    process.env.AUTH_EMAIL_TRANSPORT === "test"
    && !testOutboxPath
  ) {
    return { ok: false, reason: "not_configured" };
  }
  if (testOutboxPath) {
    try {
      await enqueueTestEmail(testOutboxPath, { ...message, to: recipients.join(",") });
      logEvent("email.test_outbox_recorded", {});
      return { ok: true };
    } catch (error) {
      logError(
        "email.test_outbox_failed",
        new Error("test_outbox_write_failed"),
        getSafeFileFailureMetadata(error),
      );
      return { ok: false, reason: "send_failed" };
    }
  }

  const postboxConfig = readPostboxConfig();
  if (postboxConfig) {
    try {
      await sendViaPostbox(postboxConfig, message, recipients);
      await recordSuccessfulEmailDelivery("postbox");
      logEvent("email.sent", { provider: "postbox" });
      return { ok: true };
    } catch (error) {
      logError(
        "email.send_failed",
        new Error("postbox_send_failed"),
        getSafePostboxFailureMetadata(error),
      );
      return { ok: false, reason: "send_failed" };
    }
  }

  const config = readSmtpConfig();
  if (!config) {
    return { ok: false, reason: "not_configured" };
  }

  try {
    const transporter = getTransporter(config);
    // Explicit field list: message data is never spread into the transport
    // options, so no attachment and no `raw` value can be introduced even if a
    // caller starts passing extra keys (that is the legacy `resolveContent`
    // surface which bypasses the file/URL access flags).
    await transporter.sendMail({
      from: config.from,
      replyTo: config.replyTo ?? undefined,
      to: recipients.join(","),
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    await recordSuccessfulEmailDelivery("smtp");
    logEvent("email.sent", {});
    return { ok: true };
  } catch (error) {
    logError(
      "email.send_failed",
      new Error("smtp_send_failed"),
      getSafeSmtpFailureMetadata(error),
    );
    return { ok: false, reason: "send_failed" };
  }
}

async function sendViaPostbox(
  config: PostboxConfig,
  message: EmailMessage,
  recipients: string[],
): Promise<void> {
  const endpoint = new URL("/v2/email/outbound-emails", config.endpoint);
  const body = JSON.stringify({
    FromEmailAddress: config.from,
    ...(config.replyTo ? { ReplyToAddresses: [config.replyTo] } : {}),
    Destination: { ToAddresses: recipients },
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: message.text, Charset: "UTF-8" },
          Html: { Data: message.html, Charset: "UTF-8" },
        },
      },
    },
  });
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(body).digest("hex");
  const host = endpoint.host;
  const canonicalHeaders = `content-type:application/x-amz-json-1.0\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "POST",
    endpoint.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/ses/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signingKey = hmac(
    hmac(
      hmac(
        hmac(`AWS4${config.secretAccessKey}`, dateStamp),
        config.region,
      ),
      "ses",
    ),
    "aws4_request",
  );
  const signature = hmac(signingKey, stringToSign, "hex");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.0",
        "host": host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error("postbox_http_error"), {
        code: "HTTP",
        status: response.status,
      });
    }
  } finally {
    clearTimeout(timeout);
  }
}

function hmac(key: string | Buffer, value: string): Buffer;
function hmac(key: string | Buffer, value: string, encoding: "hex"): string;
function hmac(
  key: string | Buffer,
  value: string,
  encoding?: "hex",
): string | Buffer {
  return encoding
    ? createHmac("sha256", key).update(value).digest("hex")
    : createHmac("sha256", key).update(value).digest();
}

function getSafePostboxFailureMetadata(
  error: unknown,
): Record<string, string | number> {
  const status = getErrorProperty(error, "status");
  if (
    typeof status === "number"
    && Number.isInteger(status)
    && status >= 400
    && status <= 599
  ) {
    return { failureCategory: "provider_http", responseCode: status };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { failureCategory: "timeout" };
  }
  return { failureCategory: "postbox_error" };
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

/** Returns only allowlisted, non-sensitive SMTP diagnostics. */
function getSafeSmtpFailureMetadata(
  error: unknown,
): Record<string, string | number> {
  const code = getErrorProperty(error, "code");
  const command = getErrorProperty(error, "command");
  const responseCode = getErrorProperty(error, "responseCode");
  const metadata: Record<string, string | number> = {
    failureCategory: classifySmtpFailure(code),
  };

  const safeCommand = classifySmtpCommand(command);
  if (safeCommand) metadata.smtpCommand = safeCommand;
  if (
    typeof responseCode === "number"
    && Number.isInteger(responseCode)
    && responseCode >= 400
    && responseCode <= 599
  ) {
    metadata.responseCode = responseCode;
  }
  return metadata;
}

function getSafeFileFailureMetadata(
  error: unknown,
): Record<string, string> {
  const code = getErrorProperty(error, "code");
  const safeCodes = new Set([
    "EACCES",
    "EBUSY",
    "EEXIST",
    "EISDIR",
    "EMFILE",
    "ENFILE",
    "ENOENT",
    "ENOSPC",
    "ENOTDIR",
    "EROFS",
  ]);
  return {
    failureCategory:
      typeof code === "string" && safeCodes.has(code)
        ? code.toLowerCase()
        : "filesystem_error",
  };
}

function getErrorProperty(error: unknown, key: string): unknown {
  if (!error || typeof error !== "object" || !(key in error)) {
    return undefined;
  }
  return (error as Record<string, unknown>)[key];
}

function classifySmtpFailure(code: unknown): string {
  switch (code) {
    case "EAUTH":
      return "authentication";
    case "ECONNECTION":
    case "ECONNREFUSED":
    case "ECONNRESET":
      return "connection";
    case "EDNS":
      return "dns";
    case "EENVELOPE":
      return "envelope";
    case "EMESSAGE":
      return "message";
    case "ETIMEDOUT":
      return "timeout";
    default:
      return "smtp_error";
  }
}

function classifySmtpCommand(command: unknown): string | null {
  switch (command) {
    case "CONN":
    case "CONNECT":
      return "connect";
    case "EHLO":
    case "HELO":
      return "hello";
    case "AUTH":
    case "AUTH PLAIN":
    case "AUTH LOGIN":
    case "AUTH XOAUTH2":
      return "authenticate";
    case "MAIL FROM":
      return "mail_from";
    case "RCPT TO":
      return "recipient";
    case "DATA":
      return "data";
    default:
      return null;
  }
}
