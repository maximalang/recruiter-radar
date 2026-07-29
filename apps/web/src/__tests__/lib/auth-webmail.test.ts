import { getAuthWebmailUrl } from "@/lib/auth-v2/webmail";

describe("auth webmail links", () => {
  test.each([
    ["owner@gmail.com", "https://mail.google.com/"],
    ["owner@yandex.ru", "https://mail.yandex.ru/"],
    ["owner@ya.ru", "https://mail.yandex.ru/"],
    ["owner@mail.ru", "https://e.mail.ru/inbox/"],
    ["owner@outlook.com", "https://outlook.live.com/mail/"],
  ])("maps %s to a known HTTPS mailbox", (email, expected) => {
    expect(getAuthWebmailUrl(email)).toBe(expected);
  });

  test("does not guess a mailbox for a corporate domain", () => {
    expect(getAuthWebmailUrl("owner@agency.example")).toBeNull();
  });
});
