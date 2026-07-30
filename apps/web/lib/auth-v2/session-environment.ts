export type AuthSessionEnvironment = {
  deviceLabel: string;
  browserLabel: string;
  environmentLabel: string;
};

const MAX_USER_AGENT_LENGTH = 1024;

export function classifyAuthSessionEnvironment(
  userAgentInput: unknown,
): AuthSessionEnvironment {
  const userAgent = typeof userAgentInput === "string"
    ? userAgentInput.slice(0, MAX_USER_AGENT_LENGTH)
    : "";

  const environmentLabel = detectEnvironment(userAgent);
  return {
    deviceLabel: detectDevice(userAgent),
    browserLabel: detectBrowser(userAgent),
    environmentLabel,
  };
}

export function isAuthSessionEnvironment(
  value: unknown,
): value is AuthSessionEnvironment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    validLabel(candidate.deviceLabel, 120)
    && validLabel(candidate.browserLabel, 80)
    && validLabel(candidate.environmentLabel, 120)
  );
}

function detectDevice(userAgent: string): string {
  if (/iPad|Tablet|PlayBook/i.test(userAgent)) return "Планшет";
  if (/Mobi|iPhone|Android/i.test(userAgent)) return "Мобильное устройство";
  return userAgent ? "Компьютер" : "Неизвестное устройство";
}

function detectBrowser(userAgent: string): string {
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Chrome\//i.test(userAgent) && !/Edg\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return "Safari";
  return "Неизвестный браузер";
}

function detectEnvironment(userAgent: string): string {
  if (/Windows NT/i.test(userAgent)) return "Windows";
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Неизвестная среда";
}

function validLabel(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.trim() === value
    && Buffer.byteLength(value, "utf8") <= maxBytes
    && !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
