import Link from "next/link";

import { pluralForm } from "@/lib/format/plural";

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
        border: "1px solid var(--color-separator)",
        borderRadius: "var(--radius-surface)",
      }}
    >
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>
          {user.fullName ?? user.email}
          {user.fullName ? (
            <span style={{ fontWeight: 400, color: "var(--color-text-tertiary)" }}> · {user.email}</span>
          ) : null}
        </div>
        <div style={{ fontSize: "0.76rem", color: "var(--color-text-tertiary)", display: "grid", gap: "2px", marginTop: "4px" }}>
          <span>
            Рабочее пространство: {user.workspace ? `${user.workspace.name} · ${user.workspace.role}` : "нет"}
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
            Оплата: {user.hasPaidOrder
              ? `${user.paidOrderCount} ${pluralForm(user.paidOrderCount, ["оплаченный заказ", "оплаченных заказа", "оплаченных заказов"])}`
              : "нет оплаченных заказов"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
          <Link
            href={`/admin/users/${user.id}${user.workspace ? `?workspaceId=${user.workspace.id}` : ""}`}
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-control)",
              fontWeight: 600,
              fontSize: "0.76rem",
              border: "1px solid var(--color-separator)",
              color: "var(--color-text-secondary)",
              textDecoration: "none",
            }}
          >
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
          <span style={tagStyle("var(--color-positive)")}>оплачен</span>
        ) : null}
        {user.access.status === "active" ? (
          <span style={tagStyle("var(--color-information)")}>доступ: {user.access.source}</span>
        ) : null}
        {profileActive && hasTelegram ? (
          <span style={tagStyle("var(--color-signal)")}>доставка</span>
        ) : null}
        <span style={{ fontSize: "0.72rem", color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>
          {new Date(user.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>
    </div>
  );
}

function tagStyle(color: string): React.CSSProperties {
  return {
    padding: "3px 8px",
    borderRadius: "var(--radius-pill)",
    fontSize: "0.72rem",
    fontWeight: 700,
    color,
    background: "var(--color-surface-secondary)",
    whiteSpace: "nowrap",
  };
}
