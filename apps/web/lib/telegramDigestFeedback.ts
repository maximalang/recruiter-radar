import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { HhDigestItem } from "./hhDigest";

export type TelegramReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type TelegramDigestFeedbackItem = Pick<HhDigestItem, "rank" | "org_id" | "employer_name"> & {
  /** Candidate identity binds a button to the digest row it was rendered for. */
  digest_candidate_id?: string | null;
};

const TELEGRAM_DIGEST_FEEDBACK_ACTIONS = [
  {
    key: "accepted",
    label: "Беру"
  },
  {
    key: "badfit",
    label: "Мимо"
  },
  {
    key: "snooze",
    label: "Позже"
  },
  {
    key: "contacted",
    label: "Уже написал"
  },
  {
    key: "replied",
    label: "Ответили"
  },
  {
    key: "meeting",
    label: "Созвон"
  },
  {
    key: "won",
    label: "Клиент"
  },
  {
    key: "dismissed",
    label: "Скрыть"
  }
] as const;

// Telegram limits callback_data to 64 bytes. Version 3 binds a callback to a
// digest candidate, carries an expiry and a nonce, and signs the compact form.
// The candidate is the server-side message identity: its row links back to the
// digest run and is re-checked by the mutation boundary.
const TELEGRAM_CALLBACK_DATA_LIMIT = 64;
const DIGEST_FEEDBACK_V2_SIG_LENGTH = 22;
const DIGEST_FEEDBACK_V3_SIG_LENGTH = 16;
const DIGEST_FEEDBACK_CALLBACK_VERSION = "d2";
const DIGEST_FEEDBACK_CALLBACK_V3_VERSION = "d3";
const DIGEST_FEEDBACK_CALLBACK_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_POSTGRES_BIGINT = BigInt("9223372036854775807");

const ACTION_TO_CODE = {
  shown: "v",
  accepted: "a",
  badfit: "b",
  snooze: "s",
  contacted: "c",
  replied: "r",
  meeting: "m",
  won: "w",
  dismissed: "d",
} as const;

const CODE_TO_ACTION: Record<string, "shown" | "accepted" | "badfit" | "snooze" | "contacted" | "replied" | "meeting" | "won" | "dismissed"> = {
  v: "shown",
  a: "accepted",
  b: "badfit",
  s: "snooze",
  c: "contacted",
  r: "replied",
  m: "meeting",
  w: "won",
  d: "dismissed",
};

export type SignedDigestFeedbackCallback = {
  client_profile_id: string;
  org_id: string | null;
  digest_candidate_id: string | null;
  action: "shown" | "accepted" | "badfit" | "snooze" | "contacted" | "replied" | "meeting" | "won" | "dismissed";
  sig: string;
  nonce?: string;
  expires_at?: number;
};

export type UnsignedDigestFeedbackCallback = {
  client_profile_id: string;
  org_id: string | null;
  digest_candidate_id: string | null;
  action: "shown" | "accepted" | "badfit" | "snooze" | "contacted" | "replied" | "meeting" | "won" | "dismissed";
};

export function buildTelegramDigestAuditItems(items: readonly HhDigestItem[]) {
  return items.map((item) => ({
    org_id: item.org_id,
    rank: item.rank,
    employer_name: item.employer_name
  }));
}

export function buildTelegramDigestFeedbackReplyMarkup(input: {
  clientProfileId: string;
  items: readonly TelegramDigestFeedbackItem[];
}) {
  const clientProfileId = normalizePositiveIntegerString(input.clientProfileId);

  if (!clientProfileId) {
    return null;
  }

  const inlineKeyboard = input.items
    .map((item) => buildItemFeedbackRows(clientProfileId, item))
    .flat();

  if (inlineKeyboard.length === 0) {
    return null;
  }

  return {
    inline_keyboard: inlineKeyboard
  };
}

function buildItemFeedbackRows(clientProfileId: string, item: TelegramDigestFeedbackItem) {
  const org_id = normalizePositiveIntegerString(item.org_id);

  if (!org_id) {
    return [];
  }

  return [
    [
      {
        text: `${item.rank}. ${truncateLabel(item.employer_name)}`,
        callback_data: buildFeedbackCallbackData({
          clientProfileId,
          org_id,
          digest_candidate_id: item.digest_candidate_id ?? null,
          action: "shown"
        })
      }
    ],
    ...chunk(
      TELEGRAM_DIGEST_FEEDBACK_ACTIONS.map((action) => ({
        text: action.label,
        callback_data: buildFeedbackCallbackData({
          clientProfileId,
          org_id,
          digest_candidate_id: item.digest_candidate_id ?? null,
          action: action.key
        })
      })),
      4,
    ),
  ];
}

function buildFeedbackCallbackData(input: {
  clientProfileId: string;
  org_id: string;
  digest_candidate_id: string | null;
  action: "shown" | "accepted" | "badfit" | "snooze" | "contacted" | "replied" | "meeting" | "won" | "dismissed";
}): string {
  const code = ACTION_TO_CODE[input.action];
  const encodedClientProfileId = encodeBigSerialBase36(input.clientProfileId);
  if (!encodedClientProfileId) {
    throw new Error("digest feedback callback identifiers are invalid");
  }

  if (input.digest_candidate_id) {
    const encodedCandidateId = encodeBigSerialBase36(input.digest_candidate_id);
    if (!encodedCandidateId) {
      throw new Error("digest feedback callback identifiers are invalid");
    }
    return buildV3FeedbackCallbackData({
      encodedClientProfileId,
      encodedCandidateId,
      code,
    });
  }

  const encodedOrgId = encodeBigSerialBase36(input.org_id);
  if (!encodedOrgId) {
    throw new Error("digest feedback callback identifiers are invalid");
  }

  const unsignedPayload = `${DIGEST_FEEDBACK_CALLBACK_VERSION}:${encodedClientProfileId}:${encodedOrgId}:${code}`;
  const sig = signDigestFeedbackPayload(unsignedPayload, DIGEST_FEEDBACK_V2_SIG_LENGTH);
  const data = `${DIGEST_FEEDBACK_CALLBACK_VERSION}:${encodedClientProfileId}:${encodedOrgId}:${code}:${sig}`;
  assertCallbackDataLength(data);
  return data;
}

function buildV3FeedbackCallbackData(input: {
  encodedClientProfileId: string;
  encodedCandidateId: string;
  code: string;
}): string {
  const expiresAt = Math.floor(Date.now() / 1000) + DIGEST_FEEDBACK_CALLBACK_TTL_SECONDS;
  const encodedExpiresAt = expiresAt.toString(36);
  // Four random bytes make the issued token distinct while keeping the signed
  // form within Telegram's 64-byte callback_data limit at BIGSERIAL maximum.
  const nonce = randomBytes(4).toString("base64url");
  const unsignedPayload = `${DIGEST_FEEDBACK_CALLBACK_V3_VERSION}:${input.encodedClientProfileId}:${input.encodedCandidateId}:${encodedExpiresAt}:${nonce}:${input.code}`;
  const sig = signDigestFeedbackPayload(unsignedPayload, DIGEST_FEEDBACK_V3_SIG_LENGTH);
  const data = `${unsignedPayload}:${sig}`;
  assertCallbackDataLength(data);
  return data;
}

function assertCallbackDataLength(data: string): void {
  if (Buffer.byteLength(data, "utf8") > TELEGRAM_CALLBACK_DATA_LIMIT) {
    throw new Error("digest feedback callback_data exceeds Telegram limit");
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function signDigestFeedbackPayload(payload: string, length: number): string {
  const secret = (process.env.DIGEST_CALLBACK_SECRET ?? "").trim();
  if (!secret) {
    throw new Error("DIGEST_CALLBACK_SECRET is not configured.");
  }
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return hmac.digest("base64url").slice(0, length);
}

export function verifyDigestFeedbackCallback(data: string | null): SignedDigestFeedbackCallback | null {
  if (!data) return null;
  if (Buffer.byteLength(data, "utf8") > TELEGRAM_CALLBACK_DATA_LIMIT) return null;
  const parts = data.split(":");
  if (!parts.length || !(process.env.DIGEST_CALLBACK_SECRET ?? "").trim()) return null;

  const [version] = parts;
  if (version === DIGEST_FEEDBACK_CALLBACK_V3_VERSION) {
    return verifyV3DigestFeedbackCallback(parts);
  }
  if (parts.length !== 5) return null;

  const [, encodedClientProfileId, encodedOrgId, code, sig] = parts;
  const action = CODE_TO_ACTION[code];
  if (!action || sig.length !== DIGEST_FEEDBACK_V2_SIG_LENGTH) return null;

  let clientProfileId: string | null = null;
  let orgId: string | null = null;
  let unsignedPayload: string | null = null;
  if (version === "d") {
    if (!isPositiveIntegerString(encodedClientProfileId) || !isPositiveIntegerString(encodedOrgId)) return null;
    clientProfileId = encodedClientProfileId;
    orgId = encodedOrgId;
    unsignedPayload = `${clientProfileId}:${orgId}:${code}`;
  } else if (version === DIGEST_FEEDBACK_CALLBACK_VERSION) {
    clientProfileId = decodeBigSerialBase36(encodedClientProfileId);
    orgId = decodeBigSerialBase36(encodedOrgId);
    if (!clientProfileId || !orgId) return null;
    unsignedPayload = `${DIGEST_FEEDBACK_CALLBACK_VERSION}:${encodedClientProfileId}:${encodedOrgId}:${code}`;
  } else {
    return null;
  }

  if (!hasMatchingSignature(unsignedPayload, sig, DIGEST_FEEDBACK_V2_SIG_LENGTH)) return null;

  return {
    client_profile_id: clientProfileId,
    org_id: orgId,
    digest_candidate_id: null,
    action,
    sig,
  };
}

function verifyV3DigestFeedbackCallback(parts: string[]): SignedDigestFeedbackCallback | null {
  if (parts.length !== 7) return null;
  const [, encodedClientProfileId, encodedCandidateId, encodedExpiresAt, nonce, code, sig] = parts;
  const action = CODE_TO_ACTION[code];
  const clientProfileId = decodeBigSerialBase36(encodedClientProfileId);
  const digestCandidateId = decodeBigSerialBase36(encodedCandidateId);
  const expiresAt = decodePositiveBase36Integer(encodedExpiresAt);
  if (
    !action ||
    !clientProfileId ||
    !digestCandidateId ||
    expiresAt === null ||
    nonce.length !== 6 ||
    !/^[A-Za-z0-9_-]+$/.test(nonce) ||
    sig.length !== DIGEST_FEEDBACK_V3_SIG_LENGTH ||
    expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  const unsignedPayload = `${DIGEST_FEEDBACK_CALLBACK_V3_VERSION}:${encodedClientProfileId}:${encodedCandidateId}:${encodedExpiresAt}:${nonce}:${code}`;
  if (!hasMatchingSignature(unsignedPayload, sig, DIGEST_FEEDBACK_V3_SIG_LENGTH)) return null;

  return {
    client_profile_id: clientProfileId,
    org_id: null,
    digest_candidate_id: digestCandidateId,
    action,
    sig,
    nonce,
    expires_at: expiresAt,
  };
}

function hasMatchingSignature(payload: string, received: string, length: number): boolean {
  const expectedSig = signDigestFeedbackPayload(payload, length);
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  const receivedBuf = Buffer.from(received, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

function isPositiveIntegerString(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) return false;
  return BigInt(value) <= MAX_POSTGRES_BIGINT;
}

function normalizePositiveIntegerString(value: string | null | undefined): string | null {
  if (!isPositiveIntegerString(value)) return null;
  return BigInt(value).toString(10);
}

function encodeBigSerialBase36(value: string): string | null {
  if (!isPositiveIntegerString(value)) return null;
  return BigInt(value).toString(36);
}

function decodePositiveBase36Integer(value: string | undefined): number | null {
  if (!value || !/^[0-9a-z]+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 36);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeBigSerialBase36(value: string | undefined): string | null {
  if (!value || !/^[0-9a-z]+$/.test(value)) return null;
  let decoded = BigInt("0");
  for (const character of value) {
    const codePoint = character.charCodeAt(0);
    const digit = codePoint <= 57 ? codePoint - 48 : codePoint - 87;
    if (digit < 0 || digit >= 36) return null;
    decoded = decoded * BigInt("36") + BigInt(digit);
    if (decoded > MAX_POSTGRES_BIGINT) return null;
  }
  return decoded > BigInt("0") ? decoded.toString(10) : null;
}

function truncateLabel(value: string): string {
  const normalizedValue = value.trim();

  const TELEGRAM_BUTTON_LABEL_BYTE_LIMIT = 24;
  const ellipsis = "…";

  if (Buffer.byteLength(normalizedValue, "utf8") <= TELEGRAM_BUTTON_LABEL_BYTE_LIMIT) {
    return normalizedValue || "Компания";
  }

  // Trim by bytes, not chars — Telegram counts bytes in UTF-8
  // Walk backwards from the full string to find the longest prefix that fits
  let low = 0;
  let high = normalizedValue.length;
  // Ellipsis itself costs 3 bytes in UTF-8
  const ellipsisBytes = Buffer.byteLength(ellipsis, "utf8");
  const maxContentBytes = TELEGRAM_BUTTON_LABEL_BYTE_LIMIT - ellipsisBytes;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(normalizedValue.slice(0, mid), "utf8") <= maxContentBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return normalizedValue.slice(0, low) + ellipsis;
}