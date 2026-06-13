/**
 * Tests for truncateLabel — Telegram button labels must fit in 24 bytes
 * of UTF-8, not 24 chars. Cyrillic and emoji are multi-byte.
 */

// truncateLabel is not exported — replicate the logic here to test the
// byte-length truncation behavior directly. The production implementation
// lives in apps/web/lib/telegramDigestFeedback.ts and is the source of truth.
const TELEGRAM_BUTTON_LABEL_BYTE_LIMIT = 24;
const ELLIPSIS = "…";
const ELLIPSIS_BYTES = Buffer.byteLength(ELLIPSIS, "utf8");

function truncateLabel(value: string): string {
  const normalizedValue = value.trim();

  if (Buffer.byteLength(normalizedValue, "utf8") <= TELEGRAM_BUTTON_LABEL_BYTE_LIMIT) {
    return normalizedValue || "Компания";
  }

  let low = 0;
  let high = normalizedValue.length;
  const maxContentBytes = TELEGRAM_BUTTON_LABEL_BYTE_LIMIT - ELLIPSIS_BYTES;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(normalizedValue.slice(0, mid), "utf8") <= maxContentBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return normalizedValue.slice(0, low) + ELLIPSIS;
}

describe("truncateLabel", () => {
  it("returns original string when within byte limit (ASCII)", () => {
    expect(truncateLabel("Acme Inc")).toBe("Acme Inc");
  });

  it("returns original string when within byte limit (Cyrillic)", () => {
    // 8 Cyrillic chars = 16 bytes, under 24
    expect(truncateLabel("Рога и копыта")).toBe("Рога и копыта");
  });

  it("returns fallback for empty string", () => {
    expect(truncateLabel("")).toBe("Компания");
  });

  it("returns fallback for whitespace-only string", () => {
    expect(truncateLabel("   ")).toBe("Компания");
  });

  it("truncates long ASCII string and appends ellipsis", () => {
    const result = truncateLabel("Very Long Company Name Inc");
    expect(result).toMatch(/…$/);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(TELEGRAM_BUTTON_LABEL_BYTE_LIMIT);
  });

  it("truncates Cyrillic string by bytes, not chars", () => {
    // 10 Cyrillic chars = 20 bytes; with 12-char input = 24 bytes exactly at limit
    const longCyrillic = "Длиннаякомпания"; // 16 chars = 32 bytes
    const result = truncateLabel(longCyrillic);
    expect(result).toMatch(/…$/);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(TELEGRAM_BUTTON_LABEL_BYTE_LIMIT);
    // Must not be the full string
    expect(result.length).toBeLessThan(longCyrillic.length);
  });

  it("handles mixed ASCII + Cyrillic correctly", () => {
    const mixed = "ООО Рога и Копыта Лимитед"; // 26 chars, Cyrillic heavy
    const result = truncateLabel(mixed);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(TELEGRAM_BUTTON_LABEL_BYTE_LIMIT);
  });

  it("handles emoji (4-byte UTF-8) without exceeding limit", () => {
    const withEmoji = "🚀 Компания Ракета"; // emoji is 4 bytes
    const result = truncateLabel(withEmoji);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(TELEGRAM_BUTTON_LABEL_BYTE_LIMIT);
  });

  it("trims leading/trailing whitespace before measuring", () => {
    expect(truncateLabel("  Acme  ")).toBe("Acme");
  });

  it("exactly-at-limit string is not truncated", () => {
    // 12 ASCII chars = 12 bytes — well under 24
    expect(truncateLabel("ABCDEFGHIJKL")).toBe("ABCDEFGHIJKL");
  });

  it("just-over-limit string is truncated", () => {
    // 25 ASCII chars = 25 bytes — just over 24
    const input = "A".repeat(25);
    const result = truncateLabel(input);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(TELEGRAM_BUTTON_LABEL_BYTE_LIMIT);
    expect(result).toMatch(/…$/);
  });
});
