import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const CIPHER_VERSION = "v1";
const IV_BYTES = 12;

function decodeConfiguredKey(raw: string): Buffer | null {
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  try {
    const decoded = Buffer.from(raw, "base64");
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

function getEncryptionKey(): Buffer {
  const configured = process.env.NOTIFICATION_ENCRYPTION_KEY?.trim();
  if (configured) {
    const decoded = decodeConfiguredKey(configured);
    if (!decoded) {
      throw new Error(
        "NOTIFICATION_ENCRYPTION_KEY must be a 32-byte base64 value or 64 hex characters.",
      );
    }
    return decoded;
  }

  // Keeps existing deployments operational during rollout. Production should set a
  // dedicated key so session signing and provider credential encryption are isolated.
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (sessionSecret && sessionSecret.length >= 32) {
    return createHash("sha256").update(sessionSecret, "utf8").digest();
  }

  throw new Error(
    "Notification credentials cannot be stored: set NOTIFICATION_ENCRYPTION_KEY.",
  );
}

export function encryptNotificationSecret(
  value: Record<string, unknown>,
  aad: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    CIPHER_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptNotificationSecret<T extends object>(
  envelope: string,
  aad: string,
): T {
  const [version, ivRaw, tagRaw, ciphertextRaw] = envelope.split(".");
  if (
    version !== CIPHER_VERSION ||
    !ivRaw ||
    !tagRaw ||
    !ciphertextRaw
  ) {
    throw new Error("Unsupported notification secret envelope.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  const parsed = JSON.parse(plaintext) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Notification secret payload is invalid.");
  }

  return parsed as T;
}

export function hashNotificationToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function redactProviderSecret(value: string): string {
  return value
    .replace(/(?:bot)?\d{8,}:[A-Za-z0-9_-]{30,}/g, "[redacted-token]")
    .replace(/([?&](?:access_token|token|key|secret)=)[^&\s]+/gi, "$1[redacted]");
}
