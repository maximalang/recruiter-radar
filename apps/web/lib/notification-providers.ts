import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type TelegramBotIdentity = {
  id: string;
  username: string;
  displayName: string;
};

export type VkCommunityIdentity = {
  id: string;
  name: string;
};

type ProviderRequestError = Error & {
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
};

function providerError(
  message: string,
  input?: { status?: number; code?: string; retryAfterSeconds?: number },
): ProviderRequestError {
  const error = new Error(message) as ProviderRequestError;
  error.status = input?.status;
  error.code = input?.code;
  error.retryAfterSeconds = input?.retryAfterSeconds;
  return error;
}

function telegramApiBase(): string {
  return (process.env.TELEGRAM_API_BASE_URL?.trim() || "https://api.telegram.org").replace(/\/+$/, "");
}

async function callTelegramApi<T>(
  botToken: string,
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`${telegramApiBase()}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (
    response.ok &&
    body &&
    typeof body === "object" &&
    (body as { ok?: unknown }).ok === true
  ) {
    return (body as { result: T }).result;
  }

  const description =
    body && typeof body === "object" && typeof (body as { description?: unknown }).description === "string"
      ? (body as { description: string }).description
      : `Telegram API request failed with status ${response.status}.`;
  const retryAfter =
    body && typeof body === "object"
      ? Number((body as { parameters?: { retry_after?: unknown } }).parameters?.retry_after)
      : Number.NaN;

  throw providerError(description, {
    status: response.status,
    code: String((body as { error_code?: unknown } | null)?.error_code ?? response.status),
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
  });
}

export async function verifyTelegramBotToken(botToken: string): Promise<TelegramBotIdentity> {
  const result = await callTelegramApi<{
    id: number | string;
    username?: string;
    first_name?: string;
  }>(botToken, "getMe");

  if (!result.username) {
    throw new Error("Telegram bot does not have a username.");
  }

  return {
    id: String(result.id),
    username: result.username,
    displayName: result.first_name?.trim() || `@${result.username}`,
  };
}

export async function configureTelegramWebhook(input: {
  botToken: string;
  webhookUrl: string;
  webhookSecret: string;
}): Promise<void> {
  await callTelegramApi(input.botToken, "setWebhook", {
    url: input.webhookUrl,
    secret_token: input.webhookSecret,
    allowed_updates: ["message", "callback_query", "my_chat_member", "channel_post"],
    drop_pending_updates: false,
  });
}

export async function deleteTelegramWebhook(input: {
  botToken: string;
  dropPendingUpdates?: boolean;
}): Promise<void> {
  await callTelegramApi(input.botToken, "deleteWebhook", {
    drop_pending_updates: input.dropPendingUpdates ?? false,
  });
}

export async function sendTelegramNotification(input: {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
}): Promise<{ providerMessageId: string }> {
  const result = await callTelegramApi<{ message_id: number | string }>(
    input.botToken,
    "sendMessage",
    {
      chat_id: input.chatId,
      text: input.text,
      ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
      disable_web_page_preview: true,
    },
  );
  return { providerMessageId: String(result.message_id) };
}

const VK_API_BASE = "https://api.vk.com/method";
const VK_API_VERSION = "5.199";

async function callVkApi<T>(
  method: string,
  token: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const form = new URLSearchParams();
  form.set("access_token", token);
  form.set("v", VK_API_VERSION);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) form.set(key, String(value));
  }

  const response = await fetch(`${VK_API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const apiError =
    body && typeof body === "object"
      ? (body as { error?: { error_code?: number; error_msg?: string } }).error
      : undefined;
  if (!response.ok || apiError) {
    throw providerError(
      apiError?.error_msg || `VK API request failed with status ${response.status}.`,
      {
        status: response.status,
        code: apiError?.error_code ? String(apiError.error_code) : String(response.status),
      },
    );
  }

  return (body as { response: T }).response;
}

export async function verifyVkCommunity(input: {
  groupId: string;
  token: string;
}): Promise<VkCommunityIdentity> {
  const response = await callVkApi<unknown>("groups.getById", input.token, {
    group_id: input.groupId,
  });

  const groups = Array.isArray(response)
    ? response
    : response && typeof response === "object" && Array.isArray((response as { groups?: unknown }).groups)
      ? (response as { groups: unknown[] }).groups
      : [];
  const group = groups[0] as { id?: number | string; name?: string } | undefined;
  if (!group?.id) throw new Error("VK community was not returned by the API.");

  return {
    id: String(group.id),
    name: group.name?.trim() || `VK ${group.id}`,
  };
}

export async function getVkCallbackConfirmationCode(input: {
  groupId: string;
  token: string;
}): Promise<string> {
  const response = await callVkApi<{ code?: string }>(
    "groups.getCallbackConfirmationCode",
    input.token,
    { group_id: input.groupId },
  );
  if (!response.code) throw new Error("VK did not return a callback confirmation code.");
  return response.code;
}

export async function configureVkCallback(input: {
  groupId: string;
  token: string;
  callbackUrl: string;
  callbackSecret: string;
}): Promise<{ serverId: string }> {
  const created = await callVkApi<{ server_id?: number | string }>(
    "groups.addCallbackServer",
    input.token,
    {
      group_id: input.groupId,
      url: input.callbackUrl,
      title: "Recruiter Radar",
      secret_key: input.callbackSecret,
    },
  );
  if (!created.server_id) throw new Error("VK callback server was not created.");

  await callVkApi("groups.setCallbackSettings", input.token, {
    group_id: input.groupId,
    server_id: created.server_id,
    api_version: VK_API_VERSION,
    message_new: true,
  });

  return { serverId: String(created.server_id) };
}

export async function deleteVkCallbackServer(input: {
  groupId: string;
  token: string;
  serverId: string;
}): Promise<void> {
  await callVkApi("groups.deleteCallbackServer", input.token, {
    group_id: input.groupId,
    server_id: input.serverId,
  });
}

export async function sendVkNotification(input: {
  token: string;
  peerId: string;
  text: string;
  randomId: number;
}): Promise<{ providerMessageId?: string }> {
  const response = await callVkApi<number | string>("messages.send", input.token, {
    peer_id: input.peerId,
    random_id: input.randomId,
    message: input.text,
  });
  return { providerMessageId: response == null ? undefined : String(response) };
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) !== 4 || isPrivateIpv4(mapped);
  }
  return false;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

function localWebhookAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function normalizeWebhookHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

export function validateWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Webhook URL is invalid.");
  }

  const hostname = normalizeWebhookHostname(url.hostname);
  const developmentHostname =
    hostname === "localhost" ||
    hostname.endsWith(".localhost");
  const reservedHostname =
    developmentHostname ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal");
  const localHttpAllowed = localWebhookAllowed() && developmentHostname && url.protocol === "http:";
  if (url.protocol !== "https:" && !localHttpAllowed) {
    throw new Error("Webhook URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Webhook URL must not contain embedded credentials.");
  }
  if (reservedHostname && !localHttpAllowed) {
    throw new Error("Webhook URL must not point to a local host.");
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) {
    throw new Error("Webhook URL must not point to a private network address.");
  }
  return url;
}

async function assertPublicWebhookTarget(target: URL): Promise<void> {
  if (localWebhookAllowed()) return;
  const hostname = normalizeWebhookHostname(target.hostname);
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw providerError("Webhook host resolves to a private or reserved network address.", {
      code: "webhook_private_address",
    });
  }
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (bytesRead < maxBytes) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const remaining = maxBytes - bytesRead;
      const value = chunk.value.byteLength > remaining ? chunk.value.slice(0, remaining) : chunk.value;
      bytesRead += value.byteLength;
      text += decoder.decode(value, { stream: bytesRead < maxBytes });
      if (chunk.value.byteLength > remaining) break;
    }
    text += decoder.decode();
    return text;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function sendSignedWebhook(input: {
  url: string;
  secret: string;
  event: string;
  eventId: string;
  payload: Record<string, unknown>;
}): Promise<{ status: number; responseText: string }> {
  const target = validateWebhookUrl(input.url);
  await assertPublicWebhookTarget(target);
  const timestamp = new Date().toISOString();
  const rawBody = JSON.stringify({
    event: input.event,
    event_id: input.eventId,
    occurred_at: timestamp,
    data: input.payload,
  });
  const signature = createHmac("sha256", input.secret).update(rawBody).digest("hex");

  const response = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Radar-Event": input.event,
      "X-Radar-Event-Id": input.eventId,
      "X-Radar-Timestamp": timestamp,
      "X-Radar-Signature": `sha256=${signature}`,
      "Idempotency-Key": input.eventId,
    },
    body: rawBody,
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    throw providerError("Webhook redirects are not allowed.", {
      status: response.status,
      code: "webhook_redirect_blocked",
    });
  }
  const responseText = await readResponseTextWithLimit(response, 2_000);
  if (!response.ok) {
    throw providerError(`Webhook returned HTTP ${response.status}.`, {
      status: response.status,
      code: `http_${response.status}`,
    });
  }

  return { status: response.status, responseText };
}

export function classifyNotificationProviderError(error: unknown): {
  kind: "retryable" | "rate_limited" | "auth" | "permanent" | "ambiguous";
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
  message: string;
} {
  const provider = error as ProviderRequestError;
  const status = typeof provider?.status === "number" ? provider.status : undefined;
  const retryAfterSeconds =
    typeof provider?.retryAfterSeconds === "number" && provider.retryAfterSeconds > 0
      ? provider.retryAfterSeconds
      : undefined;
  const message = error instanceof Error ? error.message : "Unknown provider error.";

  if (status === 429) {
    return { kind: "rate_limited", status, code: provider.code, retryAfterSeconds, message };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", status, code: provider.code, retryAfterSeconds, message };
  }
  if (!status) {
    return { kind: "ambiguous", status, code: provider.code, retryAfterSeconds, message };
  }
  if (status >= 500) {
    // The provider may have committed the user-visible side effect before its
    // gateway returned a 5xx. Without an authoritative idempotency receipt, a
    // replay is unsafe for Telegram, VK, and customer webhooks.
    return { kind: "ambiguous", status, code: provider.code, retryAfterSeconds, message };
  }
  return { kind: "permanent", status, code: provider.code, retryAfterSeconds, message };
}
