import {
  AUTH_EMAIL_TEMPLATE_NAMES,
  renderAuthEmail,
} from "@/lib/auth-v2/email-templates";

describe("auth email templates", () => {
  test.each(AUTH_EMAIL_TEMPLATE_NAMES)(
    "%s has branded HTML, plain text, and a security notice",
    (template) => {
      const message = renderAuthEmail({
        template,
        actionUrl: template === "login_signup"
          ? "https://radar.example/auth/verify#abc123"
          : "https://radar.example/settings/security",
        recipientName: "<Max & team>",
        workspaceName: "<Agency & Partners>",
        deviceLabel: "<Chrome on Windows>",
        expiresInMinutes: 15,
      });

      expect(message.subject).toContain("Recruiter Radar");
      expect(message.html).toContain("Recruiter Radar");
      expect(message.text).toContain("Recruiter Radar");
      expect(message.html).toMatch(/безопас|Если это были не вы|не запрашивали/i);
      expect(message.text).toMatch(/безопас|Если это были не вы|не запрашивали/i);
      expect(message.html).not.toMatch(/<img|tracking|pixel/i);
      expect(message.html).not.toContain("<Max & team>");
      expect(message.html).not.toContain("<Agency & Partners>");
      expect(message.html).not.toContain("<Chrome on Windows>");
    },
  );

  test("login template keeps the one-time token in an HTTPS fragment", () => {
    const actionUrl = "https://radar.example/auth/verify#abc123";
    const message = renderAuthEmail({
      template: "login_signup",
      actionUrl,
      expiresInMinutes: 15,
    });

    expect(message.subject).toBe("Вход в Recruiter Radar");
    expect(message.text).toContain(actionUrl);
    expect(message.html).toContain(actionUrl);
    expect(message.text).toContain("15 минут");
    expect(message.html).not.toContain("?token=");
    expect(message.html).not.toMatch(/[?&]email=/i);
  });

  test("rejects non-canonical action URLs", () => {
    expect(() => renderAuthEmail({
      template: "login_signup",
      actionUrl: "http://radar.example/auth/verify#secret",
      expiresInMinutes: 15,
    })).toThrow("canonical HTTPS");

    expect(() => renderAuthEmail({
      template: "login_signup",
      actionUrl: "https://user:pass@radar.example/auth/verify#secret",
      expiresInMinutes: 15,
    })).toThrow("canonical HTTPS");
  });
});
