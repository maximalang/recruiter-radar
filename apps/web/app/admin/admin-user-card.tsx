import Link from "next/link";

/**
 * One user row in the admin Users list.
 *
 * Mutations deliberately live on the workspace-aware User Control Center.
 * A user can belong to several workspaces, so acting from this actor-level
 * summary would make the mutation target ambiguous.
 */

export interface AdminUserCardData {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: string;
  workspace: { id: string; name: string; role: string } | null;
  profile: {
    id: string;
    agencyName: string;
    isActive: boolean;
    specialization: string | null;
    telegramChatId: string | null;
  } | null;
  access:
    | {
        status: "active";
        source: string;
        plan: string;
        expiresAt: string | null;
        activeSources: string[];
      }
    | { status: "inactive" };
  hasPaidOrder: boolean;
  paidOrderCount: number;
}

export default function AdminUserCard({ user }: { user: AdminUserCardData }) {
  const profileActive = user.profile?.isActive ?? false;
  const hasTelegram = Boolean(user.profile?.telegramChatId);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "12px",
        alignItems: "start",
        padding: "12px 14px",
        border: "1px solid var(--c-border, #e2e8f0)",
        borderRadius: "12px",
      }}
    >
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>
          {user.fullName ?? user.email}
          {user.fullName ? (
            <span style={{ fontWeight: 400, color: "var(--c-text-muted, #667085)" }}> · {user.email}</span>
          ) : null}
        </div>
        <div style={{ fontSize: "0.76rem", color: "var(--c-text-muted, #667085)", display: "grid", gap: "2px", marginTop: "4px" }}>
          <span>
            Workspace: {user.workspace ? `${user.workspace.name} В· ${user.workspace.role}` : "РЅРµС‚"}
          </span>
          <span>
            Профиль:{" "}
            {user.profile
              ? `${user.profile.agencyName}${user.profile.isActive ? "" : " (приостановлен)"}`
              : "нет"}
            {user.profile?.specialization ? ` · ${user.profile.specialization}` : ""}
          </span>
          <span>
            Доставка:{" "}
            {user.profile?.telegramChatId
              ? "Telegram подключён"
              : "Telegram не подключён"}
          </span>
          <span>
            Доступ:{" "}
            {user.access.status === "active"
              ? `${user.access.source} · ${user.access.plan}${
                  user.access.expiresAt
                    ? ` до ${new Date(user.access.expiresAt).toLocaleDateString("ru-RU")}`
                    : ""
                }`
              : "нет"}
          </span>
          <span>
            Оплата: {user.hasPaidOrder ? `${user.paidOrderCount} оплаченных заказов` : "нет оплаченных"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
          <Link href={`/admin/users/${user.id}${user.workspace ? `?workspaceId=${user.workspace.id}` : ""}`} style={{ padding: "6px 12px", borderRadius: "8px", fontWeight: 600, fontSize: "0.76rem", border: "1px solid #cbd5e1", color: "#334155", textDecoration: "none" }}>
            Открыть User Control Center
          </Link>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: "6px",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        {user.hasPaidOrder ? (
          <span style={tagStyle("#047857", "#d1fae5")}>оплачен</span>
        ) : null}
        {user.access.status === "active" ? (
          <span style={tagStyle("#1d4ed8", "#dbeafe")}>доступ: {user.access.source}</span>
        ) : null}
        {profileActive && hasTelegram ? (
          <span style={tagStyle("#7c3aed", "#ede9fe")}>доставка</span>
        ) : null}
        <span style={{ fontSize: "0.72rem", color: "var(--c-text-muted, #667085)", whiteSpace: "nowrap" }}>
          {new Date(user.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>
    </div>
  );
}

function tagStyle(color: string, bg: string): React.CSSProperties {
  return {
    padding: "3px 8px",
    borderRadius: "999px",
    fontSize: "0.72rem",
    fontWeight: 700,
    color,
    background: bg,
    whiteSpace: "nowrap",
  };
}
