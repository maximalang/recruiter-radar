"use client";

import { useActionState } from "react";
import {
  adminActivatePilot,
  adminPausePilot,
  adminPauseProfile,
  adminResumeProfile,
  adminClearTelegram,
} from "./admin-actions";

/**
 * One user row in the admin Users card, WITH functional write-actions.
 *
 * Each action is a small form bound to its server action via useActionState, so
 * the operator can act on a user without leaving the panel. The actions live
 * behind the operator-session gate (re-checked server-side in admin-actions).
 *
 * The row degrades gracefully: a user with no profile shows only the pilot
 * actions; a user with no Telegram shows no "отвязать Telegram" button.
 */

export interface AdminUserCardData {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: string;
  profile: {
    id: string;
    agencyName: string;
    isActive: boolean;
    specialization: string | null;
    telegramChatId: string | null;
  } | null;
  pilot: { status: string; endsAt: string | null } | null;
  hasPaidOrder: boolean;
  paidOrderCount: number;
}

function ActionButton({
  formAction,
  pending,
  label,
  tone,
}: {
  formAction: (payload: FormData) => void;
  pending: boolean;
  label: string;
  tone: "primary" | "danger" | "neutral";
}) {
  const bg =
    tone === "primary" ? "#1d4ed8" : tone === "danger" ? "#b42318" : "#475569";
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        background: bg,
        color: "#fff",
        padding: "6px 12px",
        borderRadius: "8px",
        fontWeight: 600,
        fontSize: "0.76rem",
        border: "none",
        cursor: pending ? "wait" : "pointer",
        opacity: pending ? 0.7 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {pending ? "…" : label}
    </button>
  );
}

/** A single action form with its own useActionState + inline result message. */
function UserActionForm({
  userId,
  action,
  label,
  tone,
}: {
  userId: string;
  action: (prev: { ok: boolean; message: string }, formData: FormData) => Promise<{ ok: boolean; message: string }>;
  label: string;
  tone: "primary" | "danger" | "neutral";
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false, message: "" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "stretch" }}>
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <ActionButton formAction={formAction} pending={pending} label={label} tone={tone} />
      </form>
      {state.message ? (
        <span
          style={{
            fontSize: "0.7rem",
            color: state.ok ? "#065f46" : "#b42318",
            maxWidth: "180px",
            lineHeight: 1.2,
          }}
        >
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

export default function AdminUserCard({ user }: { user: AdminUserCardData }) {
  const pilotActive = user.pilot?.status === "active";
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
            Пилот:{" "}
            {user.pilot
              ? `${user.pilot.status}${
                  user.pilot.endsAt
                    ? ` до ${new Date(user.pilot.endsAt).toLocaleDateString("ru-RU")}`
                    : ""
                }`
              : "нет"}
          </span>
          <span>
            Оплата: {user.hasPaidOrder ? `${user.paidOrderCount} оплаченных заказов` : "нет оплаченных"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
          <UserActionForm
            userId={user.id}
            action={adminActivatePilot}
            label={pilotActive ? "Продлить пилот" : "Активировать пилот"}
            tone="primary"
          />
          {pilotActive ? (
            <UserActionForm userId={user.id} action={adminPausePilot} label="Остановить пилот" tone="danger" />
          ) : null}
          {user.profile ? (
            profileActive ? (
              <UserActionForm userId={user.id} action={adminPauseProfile} label="Приостановить профиль" tone="neutral" />
            ) : (
              <UserActionForm userId={user.id} action={adminResumeProfile} label="Включить профиль" tone="primary" />
            )
          ) : null}
          {hasTelegram ? (
            <UserActionForm userId={user.id} action={adminClearTelegram} label="Отвязать Telegram" tone="danger" />
          ) : null}
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
        {pilotActive ? <span style={tagStyle("#1d4ed8", "#dbeafe")}>пилот</span> : null}
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
