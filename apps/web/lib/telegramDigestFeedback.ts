import { createHmac, timingSafeEqual } from "node:crypto";

import type { HhDigestItem } from "./hhDigest";

const TELEGRAM_DIGEST_FEEDBACK_ACTIONS = [
  {
    key: "accepted",
    label: "✅ Беру"
  },
  {
    key: "badfit",
    label: "👎 Мимо"
  },
  {
    key: "snooze",
    label: "⏸ Позже"
  }
] as const;

// Telegram limits callback_data to 64 bytes. We use 1-char action codes and a
// 22-char base64url HMAC tag (128 bits) to stay well under that ceiling.
const TELEGRAM_CALLBACK_DATA_LIMIT = 64;
const DIGEST_FEEDBACK_SIG_LENGTH = 22;

const ACTION_TO_CODE = {
  shown: "v",
  accepted: "a",
  badfit: "b",
  snooze: "s",
} as const;

const CODE_TO_ACTION: Record<string, "shown" | "accepted" | "badfit" | "snooze"> = {
  v: "shown",
  a: "accepted",
  b: "badfit",
  s: "snooze",
};

export type SignedDigestFeedbackCallback = {
  clientProfileId: string;
  orgId: string;
  action: "shown" | "accepted" | "badfit" | "snooze";
  sig: string;
};

export type UnsignedDigestFeedbackCallback = {
  clientProfileId: string;
  orgId: string;
  action: "shown" | "accepted" | "badfit" | "snooze";
};

export function buildTelegramDigestAuditItems(items: readonly HhDigestItem[]) {
  return items.map((item) => ({
    orgId: item.orgId,
    rank: item.rank,
    employerName: item.employer_name
  }));
}

export function buildTelegramDigestFeedbackReplyMarkup(input: {
  clientProfileId: string;
  items: readonly HhDigestItem[];
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

function buildItemFeedbackRows(clientProfileId: string, item: HhDigestItem) {
  const orgId = normalizePositiveIntegerString(item.orgId);

  if (!orgId) {
    return [];
  }

  return [
    [
      {
        text: `${item.rank}. ${truncateLabel(item.employer_name)}`,
        callback_data: buildFeedbackCallbackData({
          clientProfileId,
          orgId,
          action: "shown"
        })
      }
    ],
    TELEGRAM_DIGEST_FEEDBACK_ACTIONS.map((action) => ({
      text: action.label,
      callback_data: buildFeedbackCallbackData({
        clientProfileId,
        orgId,
        action: action.key
      })
    }))
  ];
}

function buildFeedbackCallbackData(input: {
  clientProfileId: string;
  orgId: string;
  action: "shown" | "accepted" | "badfit" | "snooze";
}): string {
  const unsigned: UnsignedDigestFeedbackCallback = {
    clientProfileId: input.clientProfileId,
    orgId: input.orgId,
    action: input.action,
  };
  const sig = signDigestFeedbackCallback(unsigned);
  const code = ACTION_TO_CODE[input.action];
  const data = `d:${input.clientProfileId}:${input.orgId}:${code}:${sig}`;
  if (Buffer.byteLength(data, "utf8") > TELEGRAM_CALLBACK_DATA_LIMIT) {
    throw new Error("digest feedback callback_data exceeds Telegram limit");
  }
  return data;
}

function signDigestFeedbackCallback(unsigned: UnsignedDigestFeedbackCallback): string {
  const secret = (process.env.DIGEST_CALLBACK_SECRET ?? "").trim();
  if (!secret) {
    throw new Error("DIGEST_CALLBACK_SECRET is not configured.");
  }
  const code = ACTION_TO_CODE[unsigned.action];
  const payload = `${unsigned.clientProfileId}:${unsigned.orgId}:${code}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return hmac.digest("base64url").slice(0, DIGEST_FEEDBACK_SIG_LENGTH);
}

export function verifyDigestFeedbackCallback(data: string | null): SignedDigestFeedbackCallback | null {
  if (!data) return null;
  if (Buffer.byteLength(data, "utf8") > TELEGRAM_CALLBACK_DATA_LIMIT) return null;
  const parts = data.split(":");
  if (parts.length !== 5 || parts[0] !== "d") return null;
  const [, clientProfileId, orgId, code, sig] = parts;
  if (!isPositiveIntegerString(clientProfileId) || !isPositiveIntegerString(orgId)) return null;
  const action = CODE_TO_ACTION[code];
  if (!action) return null;
  if (sig.length !== DIGEST_FEEDBACK_SIG_LENGTH) return null;

  const secret = (process.env.DIGEST_CALLBACK_SECRET ?? "").trim();
  if (!secret) return null;

  const unsigned: UnsignedDigestFeedbackCallback = {
    clientProfileId,
    orgId,
    action,
  };

  const expectedSig = signDigestFeedbackCallback(unsigned);

  // timing-safe compare to prevent brute-force of the HMAC
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  const receivedBuf = Buffer.from(sig, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return null;
  if (!timingSafeEqual(expectedBuf, receivedBuf)) return null;

  return { ...unsigned, sig };
}

export function parseDigestFeedbackCallbackData(_value: string | null | undefined): null {
  // Unsigned parser is deprecated; all feedback paths must use verifyDigestFeedbackCallback.
  return null;
}

function isPositiveIntegerString(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function normalizePositiveIntegerString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!/^\d+$/.test(normalizedValue)) {
    return null;
  }

  return normalizedValue;
}

function truncateLabel(value: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length <= 24) {
    return normalizedValue || "Компания";
  }

  return `${normalizedValue.slice(0, 21)}…`;
}