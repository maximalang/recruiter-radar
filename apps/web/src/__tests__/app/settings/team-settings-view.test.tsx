import { renderToStaticMarkup } from "react-dom/server";

import { TeamSettingsView } from "@/app/settings/team/team-settings-view";

const members = [
  {
    userId: "42",
    displayName: "Анна",
    email: "anna@example.com",
    role: "owner",
    joinedAt: new Date("2026-01-12T10:00:00.000Z"),
  },
  {
    userId: "55",
    displayName: "Олег",
    email: "oleg@example.com",
    role: "admin",
    joinedAt: new Date("2026-02-12T10:00:00.000Z"),
  },
  {
    userId: "56",
    displayName: "Ирина",
    email: "irina@example.com",
    role: "recruiter",
    joinedAt: new Date("2026-03-12T10:00:00.000Z"),
  },
] as const;

describe("workspace team settings view", () => {
  test("never offers owner as a generic invitation or role option", () => {
    const html = renderToStaticMarkup(
      <TeamSettingsView
        currentUserId="42"
        team={{
          workspaceId: "9",
          workspaceName: "North Star",
          actorRole: "owner",
          members: [...members],
          invites: [],
        }}
        status={{}}
      />,
    );

    expect(html).toContain('value="admin"');
    expect(html).toContain('value="recruiter"');
    expect(html).not.toContain('value="owner"');
    expect(html).not.toContain('name="targetUserId" value="42"');
    expect(html).toContain('name="targetUserId" value="55"');
    expect(html).toContain("Передать владение");
  });

  test("an admin cannot assign or manage administrators", () => {
    const html = renderToStaticMarkup(
      <TeamSettingsView
        currentUserId="55"
        team={{
          workspaceId: "9",
          workspaceName: "North Star",
          actorRole: "admin",
          members: [...members],
          invites: [],
        }}
        status={{}}
      />,
    );

    expect(html).not.toContain('value="admin"');
    expect(html).not.toContain('name="targetUserId" value="55"');
    expect(html).toContain('name="targetUserId" value="56"');
    expect(html).not.toContain("Передать владение");
  });

  test("shows pending invitations with delivery status and revocation", () => {
    const html = renderToStaticMarkup(
      <TeamSettingsView
        currentUserId="42"
        team={{
          workspaceId: "9",
          workspaceName: "North Star",
          actorRole: "owner",
          members: [...members],
          invites: [{
            id: "77",
            email: "new@example.com",
            role: "viewer",
            expiresAt: new Date("2026-07-30T10:00:00.000Z"),
            sendStatus: "failed",
          }],
        }}
        status={{ invite: "delivery" }}
      />,
    );

    expect(html).toContain("new@example.com");
    expect(html).toContain("Не доставлено");
    expect(html).toContain('name="inviteId" value="77"');
    expect(html).toContain("Отозвать");
  });
});
