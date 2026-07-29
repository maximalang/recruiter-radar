const WEBMAIL_BY_DOMAIN: Readonly<Record<string, string>> = {
  "gmail.com": "https://mail.google.com/",
  "googlemail.com": "https://mail.google.com/",
  "yandex.ru": "https://mail.yandex.ru/",
  "yandex.com": "https://mail.yandex.ru/",
  "ya.ru": "https://mail.yandex.ru/",
  "mail.ru": "https://e.mail.ru/inbox/",
  "inbox.ru": "https://e.mail.ru/inbox/",
  "bk.ru": "https://e.mail.ru/inbox/",
  "list.ru": "https://e.mail.ru/inbox/",
  "outlook.com": "https://outlook.live.com/mail/",
  "hotmail.com": "https://outlook.live.com/mail/",
  "live.com": "https://outlook.live.com/mail/",
};

export function getAuthWebmailUrl(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return WEBMAIL_BY_DOMAIN[email.slice(at + 1).trim().toLowerCase()] ?? null;
}
