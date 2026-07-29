import { renderToStaticMarkup } from "react-dom/server";

import { SecuritySettingsView } from "@/app/settings/security/security-settings-view";

const profile = {
  id: "42",
  displayName: "Анна Смирнова",
  email: "anna@example.com",
  createdAt: new Date("2026-01-12T10:00:00.000Z"),
  emailVerifiedAt: new Date("2026-01-12T10:05:00.000Z"),
  workspaceId: "9",
  workspaceName: "North Star",
  role: "owner",
} as const;

const sessions = [
  {
    id: "77",
    authMethod: "magic_link",
    deviceLabel: "Компьютер",
    browserLabel: "Chrome",
    environmentLabel: "Windows",
    createdAt: new Date("2026-07-20T10:00:00.000Z"),
    lastSeenAt: new Date("2026-07-29T10:00:00.000Z"),
    current: true,
  },
  {
    id: "88",
    authMethod: "passkey",
    deviceLabel: "Телефон",
    browserLabel: "Safari",
    environmentLabel: "iOS",
    createdAt: new Date("2026-07-22T10:00:00.000Z"),
    lastSeenAt: new Date("2026-07-28T10:00:00.000Z"),
    current: false,
  },
] as const;

describe("account security settings view", () => {
  test("shows profile and privacy-safe session labels without network identifiers", () => {
    const html = renderToStaticMarkup(
      <SecuritySettingsView
        profile={profile}
        sessions={[...sessions]}
        status={{}}
      />,
    );

    expect(html).toContain("anna@example.com");
    expect(html).toContain("Chrome");
    expect(html).toContain("Windows");
    expect(html).toContain("Safari");
    expect(html).not.toMatch(/\bIP\b|ip-адрес|user-agent/i);
    expect(html).toContain('name="sessionId" value="88"');
  });

  test("renders explicit reauthentication guidance and the exact deletion phrase", () => {
    const html = renderToStaticMarkup(
      <SecuritySettingsView
        profile={profile}
        sessions={[...sessions]}
        status={{ email: "reauth" }}
      />,
    );

    expect(html).toContain("Войти заново");
    expect(html).toContain("УДАЛИТЬ АККАУНТ");
    expect(html).toContain('name="confirmation"');
  });

  test("does not offer a selected-session revoke button for the current session", () => {
    const html = renderToStaticMarkup(
      <SecuritySettingsView
        profile={profile}
        sessions={[sessions[0]]}
        status={{}}
      />,
    );

    expect(html).toContain("Текущая");
    expect(html).not.toContain('name="sessionId"');
  });
});
