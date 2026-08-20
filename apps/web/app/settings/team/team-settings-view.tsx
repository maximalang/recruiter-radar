import Link from "next/link";

import type {
  WorkspaceTeam,
  WorkspaceTeamMember,
} from "@/lib/auth-v2/workspace-team";
import type { WorkspaceRole } from "@/lib/auth-v2/workspaces";
import { pluralForm } from "@/lib/format/plural";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  transferOwnershipAction,
} from "./actions";
import styles from "./team-settings.module.css";

export type TeamSettingsStatus = {
  invite?: string;
  member?: string;
  transfer?: string;
  error?: string;
};

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  recruiter: "Рекрутер",
  viewer: "Наблюдатель",
  billing: "Оплата",
};

const MANAGED_ROLES: Exclude<WorkspaceRole, "owner">[] = [
  "admin",
  "recruiter",
  "viewer",
  "billing",
];

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(value);
}

function canManageMember(
  actorRole: WorkspaceTeam["actorRole"],
  actorUserId: string,
  member: WorkspaceTeamMember,
): boolean {
  if (member.userId === actorUserId || member.role === "owner") return false;
  if (actorRole === "owner") return true;
  return member.role !== "admin";
}

function availableRoles(
  actorRole: WorkspaceTeam["actorRole"],
): Exclude<WorkspaceRole, "owner">[] {
  return actorRole === "owner"
    ? MANAGED_ROLES
    : MANAGED_ROLES.filter((role) => role !== "admin");
}

function statusNotice(status: TeamSettingsStatus): {
  tone: "success" | "warning";
  text: string;
  reauth?: boolean;
} | null {
  if (status.invite === "sent") {
    return { tone: "success", text: "Приглашение отправлено." };
  }
  if (status.invite === "delivery") {
    return {
      tone: "warning",
      text: "Приглашение создано, но письмо не доставлено. Отзовите его перед повторной отправкой.",
    };
  }
  if (status.invite === "revoked") {
    return { tone: "success", text: "Приглашение отозвано." };
  }
  if (status.invite) {
    return {
      tone: "warning",
      text: status.invite === "conflict"
        ? "Этот адрес уже состоит в команде или ожидает приглашения."
        : status.invite === "denied"
          ? "У вашей роли нет права отправить такое приглашение."
          : "Не удалось изменить приглашение. Проверьте данные.",
    };
  }
  if (status.member === "role-changed") {
    return { tone: "success", text: "Роль участника изменена. Его прежние сессии завершены." };
  }
  if (status.member === "removed") {
    return { tone: "success", text: "Участник удалён, доступ отозван сразу." };
  }
  if (status.member) {
    return {
      tone: "warning",
      text: status.member === "denied"
        ? "Эту роль или участника нельзя изменить с вашими правами."
        : "Не удалось изменить состав команды.",
    };
  }
  if (status.transfer === "reauth") {
    return {
      tone: "warning",
      text: "Для передачи владения нужен недавний вход.",
      reauth: true,
    };
  }
  if (status.transfer) {
    return {
      tone: "warning",
      text: "Не удалось передать владение. Проверьте участника и права.",
    };
  }
  return null;
}

export function TeamSettingsView(props: {
  currentUserId: string;
  team: WorkspaceTeam;
  status: TeamSettingsStatus;
}) {
  const roles = availableRoles(props.team.actorRole);
  const notice = statusNotice(props.status);
  const transferTargets = props.team.members.filter(
    (member) =>
      member.userId !== props.currentUserId
      && member.role !== "owner",
  );

  return (
    <div className={styles.stack}>
      <nav className={styles.subnav} aria-label="Разделы настроек">
        <Link href="/settings">Обзор</Link>
        <Link href="/settings/security">Безопасность</Link>
        <Link href="/settings/team" aria-current="page">Команда</Link>
      </nav>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Рабочее пространство</span>
          <h2>{props.team.workspaceName}</h2>
          <p>
            {props.team.actorRole === "owner"
              ? "Вы управляете ролями, доступом и передачей владения."
              : "Вы управляете участниками ниже уровня администратора."}
          </p>
        </div>
        <div className={styles.heroMetric}>
          <strong>{props.team.members.length}</strong>
          <span>{pluralForm(props.team.members.length, ["участник", "участника", "участников"])}</span>
        </div>
      </section>

      {notice ? (
        <div className={styles.notice} data-tone={notice.tone} role="status">
          <span>{notice.text}</span>
          {notice.reauth ? (
            <Link href="/login?returnTo=/settings/team">Войти заново</Link>
          ) : null}
        </div>
      ) : null}

      <section className={styles.card} aria-labelledby="invite-member">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Новый доступ</span>
            <h2 id="invite-member">Пригласить участника</h2>
          </div>
        </div>
        <p className={styles.muted}>
          Приглашение действует 24 часа и привязано к указанному email.
          Ссылка одноразовая.
        </p>
        <form action={inviteMemberAction} className={styles.inviteForm}>
          <label>
            <span>Рабочий email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              placeholder="colleague@company.ru"
            />
          </label>
          <label>
            <span>Роль</span>
            <select name="role" defaultValue="recruiter">
              {roles.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </label>
          <button className={styles.primaryButton} type="submit">
            Отправить приглашение
          </button>
        </form>
      </section>

      <section className={styles.card} aria-labelledby="team-members">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Активный доступ</span>
            <h2 id="team-members">Участники</h2>
          </div>
          <span className={styles.count}>{props.team.members.length}</span>
        </div>
        <ul className={styles.memberList}>
          {props.team.members.map((member) => {
            const manageable = canManageMember(
              props.team.actorRole,
              props.currentUserId,
              member,
            );
            return (
              <li key={member.userId} className={styles.member}>
                <div className={styles.avatar} aria-hidden="true">
                  {(member.displayName ?? member.email).slice(0, 1).toUpperCase()}
                </div>
                <div className={styles.memberIdentity}>
                  <div>
                    <strong>{member.displayName ?? "Без имени"}</strong>
                    {member.userId === props.currentUserId ? <span>Вы</span> : null}
                  </div>
                  <p>{member.email}</p>
                  <time dateTime={member.joinedAt.toISOString()}>
                    В команде с {formatDate(member.joinedAt)}
                  </time>
                </div>
                <span className={styles.roleBadge} data-role={member.role}>
                  {ROLE_LABELS[member.role]}
                </span>
                {manageable ? (
                  <div className={styles.memberActions}>
                    <form action={changeMemberRoleAction}>
                      <input
                        type="hidden"
                        name="targetUserId"
                        value={member.userId}
                      />
                      <label>
                        <span className={styles.visuallyHidden}>
                          Роль для {member.email}
                        </span>
                        <select name="role" defaultValue={member.role}>
                          {roles.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className={styles.quietButton} type="submit">
                        Сохранить
                      </button>
                    </form>
                    <form action={removeMemberAction}>
                      <input
                        type="hidden"
                        name="targetUserId"
                        value={member.userId}
                      />
                      <button className={styles.removeButton} type="submit">
                        Удалить
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {props.team.invites.length > 0 ? (
        <section className={styles.card} aria-labelledby="pending-invites">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>Ожидают ответа</span>
              <h2 id="pending-invites">Приглашения</h2>
            </div>
            <span className={styles.count}>{props.team.invites.length}</span>
          </div>
          <ul className={styles.inviteList}>
            {props.team.invites.map((invite) => (
              <li key={invite.id}>
                <div>
                  <strong>{invite.email}</strong>
                  <p>
                    {ROLE_LABELS[invite.role]} · до {formatDate(invite.expiresAt)}
                  </p>
                </div>
                <span
                  className={styles.deliveryBadge}
                  data-status={invite.sendStatus}
                >
                  {invite.sendStatus === "sent"
                    ? "Отправлено"
                    : invite.sendStatus === "failed"
                      ? "Не доставлено"
                      : "Отправляется"}
                </span>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="inviteId" value={invite.id} />
                  <button className={styles.removeButton} type="submit">
                    Отозвать
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {props.team.actorRole === "owner" && transferTargets.length > 0 ? (
        <section className={styles.transferCard} aria-labelledby="transfer-owner">
          <span className={styles.eyebrow}>Особое действие</span>
          <h2 id="transfer-owner">Передать владение</h2>
          <p>
            Новый владелец получит полный контроль. Ваша роль станет
            администратором, а обе активные сессии будут завершены.
          </p>
          <form action={transferOwnershipAction} className={styles.transferForm}>
            <label>
              <span>Новый владелец</span>
              <select name="targetUserId" required>
                {transferTargets.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName ?? member.email} · {ROLE_LABELS[member.role]}
                  </option>
                ))}
              </select>
            </label>
            <button className={styles.transferButton} type="submit">
              Передать владение
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
