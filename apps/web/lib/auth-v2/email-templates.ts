import type { EmailMessage } from "../email/transport";

export const AUTH_EMAIL_TEMPLATE_NAMES = [
  "login_signup",
  "change_email",
  "email_change_requested",
  "workspace_invite",
  "new_login",
  "email_changed",
  "passkey_added",
  "passkey_removed",
  "all_sessions_ended",
  "account_deletion",
] as const;

export type AuthEmailTemplateName =
  (typeof AUTH_EMAIL_TEMPLATE_NAMES)[number];

export type AuthEmailTemplateInput = {
  template: AuthEmailTemplateName;
  actionUrl?: string;
  recipientName?: string | null;
  workspaceName?: string | null;
  deviceLabel?: string | null;
  expiresInMinutes?: number;
};

type TemplateCopy = {
  subject: string;
  eyebrow: string;
  heading: string;
  body: string;
  actionLabel?: string;
  actionRequired?: boolean;
  securityNote: string;
};

const COPY: Readonly<Record<AuthEmailTemplateName, TemplateCopy>> = {
  login_signup: {
    subject: "Вход в Recruiter Radar",
    eyebrow: "Безопасный вход",
    heading: "Подтвердите рабочий email",
    body: "Перейдите по одноразовой ссылке, чтобы войти. Если аккаунта ещё нет, он будет создан только после подтверждения адреса.",
    actionLabel: "Продолжить в Recruiter Radar",
    actionRequired: true,
    securityNote: "Если вы не запрашивали вход, просто проигнорируйте это письмо. Никому не пересылайте одноразовую ссылку.",
  },
  change_email: {
    subject: "Подтверждение нового email — Recruiter Radar",
    eyebrow: "Изменение email",
    heading: "Подтвердите новый адрес",
    body: "Откройте защищённую ссылку, чтобы подтвердить новый рабочий email. До подтверждения адрес аккаунта не изменится.",
    actionLabel: "Подтвердить новый email",
    actionRequired: true,
    securityNote: "Если вы не меняли email, не открывайте ссылку и проверьте безопасность аккаунта.",
  },
  email_change_requested: {
    subject: "Запрошена смена email — Recruiter Radar",
    eyebrow: "Безопасность аккаунта",
    heading: "Получен запрос на смену email",
    body: "Основной адрес аккаунта пока не изменён. Новый email станет активным только после подтверждения защищённой ссылки на новом адресе.",
    securityNote: "Если это были не вы, завершите другие активные сессии и защитите доступ к рабочей почте.",
  },
  workspace_invite: {
    subject: "Приглашение в команду — Recruiter Radar",
    eyebrow: "Команда",
    heading: "Вас пригласили в рабочее пространство",
    body: "Примите приглашение, чтобы работать с радаром команды и её общими настройками.",
    actionLabel: "Принять приглашение",
    actionRequired: true,
    securityNote: "Если вы не ожидали приглашение, безопасно проигнорируйте письмо или уточните его у администратора команды.",
  },
  new_login: {
    subject: "Новый вход — Recruiter Radar",
    eyebrow: "Безопасность аккаунта",
    heading: "Зафиксирован новый вход",
    body: "Мы заметили новый вход в ваш аккаунт. Проверьте активные сессии, если устройство вам незнакомо.",
    actionLabel: "Проверить активные сессии",
    securityNote: "Если это были не вы, завершите другие сессии и защитите доступ к рабочей почте.",
  },
  email_changed: {
    subject: "Email аккаунта изменён — Recruiter Radar",
    eyebrow: "Безопасность аккаунта",
    heading: "Рабочий email изменён",
    body: "Адрес для входа в аккаунт Recruiter Radar был изменён.",
    actionLabel: "Проверить безопасность",
    securityNote: "Если это были не вы, немедленно обратитесь в поддержку и защитите доступ к почте.",
  },
  passkey_added: {
    subject: "Ключ доступа добавлен — Recruiter Radar",
    eyebrow: "Безопасность аккаунта",
    heading: "Добавлен новый ключ доступа",
    body: "Теперь для входа в Recruiter Radar можно использовать новый ключ доступа.",
    actionLabel: "Проверить ключи доступа",
    securityNote: "Если это были не вы, удалите неизвестный ключ и завершите другие сессии.",
  },
  passkey_removed: {
    subject: "Ключ доступа удалён — Recruiter Radar",
    eyebrow: "Безопасность аккаунта",
    heading: "Ключ доступа удалён",
    body: "Один из ключей доступа больше нельзя использовать для входа.",
    actionLabel: "Проверить ключи доступа",
    securityNote: "Если это были не вы, проверьте безопасность аккаунта и активные сессии.",
  },
  all_sessions_ended: {
    subject: "Все сессии завершены — Recruiter Radar",
    eyebrow: "Безопасность аккаунта",
    heading: "Другие сессии завершены",
    body: "Мы завершили активные сессии Recruiter Radar согласно вашему запросу.",
    actionLabel: "Войти снова",
    securityNote: "Если это были не вы, защитите доступ к рабочей почте перед новым входом.",
  },
  account_deletion: {
    subject: "Запрос на удаление аккаунта — Recruiter Radar",
    eyebrow: "Удаление аккаунта",
    heading: "Запрос на удаление принят",
    body: "Доступ к аккаунту и активные сессии деактивированы. Дальнейшая обработка выполняется по настроенной политике хранения Recruiter Radar.",
    securityNote: "Если вы не отправляли запрос, обратитесь в поддержку и защитите доступ к рабочей почте.",
  },
};

export function renderAuthEmail(
  input: AuthEmailTemplateInput,
): Omit<EmailMessage, "to"> {
  const copy = COPY[input.template];
  const actionUrl = normalizeActionUrl(input.actionUrl);
  if (copy.actionRequired && !actionUrl) {
    throw new Error("This auth email requires a canonical HTTPS action URL.");
  }

  const recipientName = normalizeDisplayValue(input.recipientName, 120);
  const workspaceName = normalizeDisplayValue(input.workspaceName, 160);
  const deviceLabel = normalizeDisplayValue(input.deviceLabel, 160);
  const expiresInMinutes = normalizeExpiry(input.expiresInMinutes);
  const greeting = recipientName ? `Здравствуйте, ${recipientName}.` : "Здравствуйте.";
  const context = buildContext(input.template, workspaceName, deviceLabel);
  const expiry = actionUrl && expiresInMinutes
    ? `Ссылка действует ${formatMinutes(expiresInMinutes)}.`
    : null;
  const actionLabel = copy.actionLabel && actionUrl
    ? copy.actionLabel
    : null;

  const text = [
    "Recruiter Radar",
    copy.eyebrow,
    "",
    greeting,
    "",
    copy.heading,
    copy.body,
    context,
    expiry,
    actionLabel && actionUrl ? `${actionLabel}: ${actionUrl}` : null,
    "",
    `Для безопасности: ${copy.securityNote}`,
    "",
    "Recruiter Radar не добавляет рекламные пиксели в служебные письма.",
  ].filter((line) => line !== null).join("\n");

  const html = [
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(copy.subject)}</title></head>`,
    '<body style="margin:0;background:#f4f0e8;color:#15233f;font-family:Arial,sans-serif">',
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">',
    `${escapeHtml(copy.heading)} · Recruiter Radar`,
    "</div>",
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e8">',
    '<tr><td align="center" style="padding:32px 16px">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #ddd4c6;border-radius:18px">',
    '<tr><td style="padding:32px">',
    '<p style="margin:0 0 24px;color:#142d63;font-size:20px;font-weight:800;letter-spacing:-.02em">Recruiter <span style="color:#b66b3d">Radar</span></p>',
    `<p style="margin:0 0 10px;color:#9b5c38;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(copy.eyebrow)}</p>`,
    `<p style="margin:0 0 18px;color:#4b5565;font-size:15px;line-height:1.6">${escapeHtml(greeting)}</p>`,
    `<h1 style="margin:0 0 14px;color:#15233f;font-size:26px;line-height:1.2">${escapeHtml(copy.heading)}</h1>`,
    `<p style="margin:0 0 14px;color:#4b5565;font-size:16px;line-height:1.65">${escapeHtml(copy.body)}</p>`,
    context
      ? `<p style="margin:0 0 14px;color:#4b5565;font-size:15px;line-height:1.6">${escapeHtml(context)}</p>`
      : "",
    expiry
      ? `<p style="margin:0 0 18px;color:#667085;font-size:14px;line-height:1.55">${escapeHtml(expiry)}</p>`
      : "",
    actionLabel && actionUrl
      ? `<p style="margin:24px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 20px;border-radius:10px;background:#142d63;color:#fff;text-decoration:none;font-size:15px;font-weight:700">${escapeHtml(actionLabel)}</a></p>`
      : "",
    `<div style="margin-top:28px;padding:16px;border-radius:12px;background:#f7f3ed;color:#5d4a3f;font-size:13px;line-height:1.55"><strong>Для безопасности:</strong> ${escapeHtml(copy.securityNote)}</div>`,
    '<p style="margin:22px 0 0;color:#7a746d;font-size:12px;line-height:1.5">Служебное письмо Recruiter Radar без рекламных пикселей.</p>',
    "</td></tr></table></td></tr></table></body></html>",
  ].join("");

  return {
    subject: copy.subject,
    html,
    text,
  };
}

function buildContext(
  template: AuthEmailTemplateName,
  workspaceName: string | null,
  deviceLabel: string | null,
): string | null {
  if (template === "workspace_invite" && workspaceName) {
    return `Рабочее пространство: ${workspaceName}.`;
  }
  if (
    (template === "new_login"
      || template === "passkey_added"
      || template === "passkey_removed")
    && deviceLabel
  ) {
    return `Устройство: ${deviceLabel}.`;
  }
  return null;
}

function normalizeActionUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Auth email action URL must be a canonical HTTPS URL.");
  }

  const localDevelopment = (
    process.env["NODE_ENV"] !== "production"
    && url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
  if (
    (url.protocol !== "https:" && !localDevelopment)
    || url.username
    || url.password
    || url.origin === "null"
    || url.origin !== canonicalAuthOrigin()
  ) {
    throw new Error("Auth email action URL must be a canonical HTTPS URL.");
  }
  if (
    [...url.searchParams.keys()].some((key) =>
      /^(?:token|code|email|address|secret)$/i.test(key))
  ) {
    throw new Error("Auth email action URL must not expose secrets or PII.");
  }
  return url.toString();
}

function canonicalAuthOrigin(): string {
  const raw = (
    process.env.AUTH_SITE_URL
    ?? process.env.PAYMENTS_SITE_URL
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.RR_APP_BASE_URL
  )?.trim();
  const fallback = process.env.NODE_ENV === "production"
    ? null
    : "http://localhost:3000";
  if (!raw && !fallback) {
    throw new Error("Auth email action URL must use the canonical HTTPS origin.");
  }

  let url: URL;
  try {
    url = new URL(raw ?? fallback!);
  } catch {
    throw new Error("Auth email action URL must use the canonical HTTPS origin.");
  }
  const localDevelopment = (
    process.env.NODE_ENV !== "production"
    && url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
  if (
    (url.protocol !== "https:" && !localDevelopment)
    || url.username
    || url.password
    || url.origin === "null"
  ) {
    throw new Error("Auth email action URL must use the canonical HTTPS origin.");
  }
  return url.origin;
}

function normalizeDisplayValue(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeExpiry(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 24 * 60) {
    throw new Error("Auth email expiry must be between 1 and 1440 minutes.");
  }
  return value;
}

function formatMinutes(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${value} минут`;
  if (mod10 === 1) return `${value} минуту`;
  if (mod10 >= 2 && mod10 <= 4) return `${value} минуты`;
  return `${value} минут`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}
