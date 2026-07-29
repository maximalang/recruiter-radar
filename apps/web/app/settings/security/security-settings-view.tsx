import Link from "next/link";

import {
  ACCOUNT_DELETION_CONFIRMATION,
  type AccountSecurityProfile,
} from "@/lib/auth-v2/account-security";
import type { AuthSessionSummary } from "@/lib/auth-v2/sessions";
import {
  deleteAccountAction,
  endAllSessionsAction,
  endCurrentSessionAction,
  endOtherSessionsAction,
  requestEmailChangeAction,
  revokeSessionAction,
} from "./actions";
import styles from "./security-settings.module.css";

export type SecuritySettingsStatus = {
  email?: string;
  sessions?: string;
  deletion?: string;
  error?: string;
};

const ROLE_LABELS: Record<AccountSecurityProfile["role"], string> = {
  owner: "Владелец",
  admin: "Администратор",
  recruiter: "Рекрутер",
  viewer: "Наблюдатель",
  billing: "Оплата",
};

const AUTH_METHOD_LABELS: Record<AuthSessionSummary["authMethod"], string> = {
  magic_link: "Ссылка для входа",
  passkey: "Ключ доступа",
  legacy_exchange: "Перенесённая сессия",
};

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(value);
}

function emailNotice(status: string | undefined) {
  if (status === "requested") {
    return {
      tone: "success",
      text: "Письмо отправлено на новый адрес. Основной email изменится только после подтверждения.",
    } as const;
  }
  if (status === "delivery") {
    return {
      tone: "warning",
      text: "Запрос создан, но письмо не доставлено. Повторите попытку позже.",
    } as const;
  }
  if (status === "reauth") {
    return {
      tone: "warning",
      text: "Для смены email нужен недавний вход.",
      action: true,
    } as const;
  }
  if (status === "conflict") {
    return {
      tone: "warning",
      text: "Этот email уже используется другим аккаунтом.",
    } as const;
  }
  if (status === "invalid") {
    return {
      tone: "warning",
      text: "Проверьте новый email и попробуйте снова.",
    } as const;
  }
  if (status) {
    return {
      tone: "warning",
      text: "Не удалось создать запрос. Попробуйте позже.",
    } as const;
  }
  return null;
}

function sessionNotice(status: string | undefined): string | null {
  if (status === "ended") return "Выбранная сессия завершена.";
  if (status === "others-ended") return "Все остальные сессии завершены.";
  if (status === "invalid") return "Эту сессию нельзя завершить выбранным способом.";
  if (status === "unavailable") {
    return "Сессия уже завершена или недоступна этому аккаунту.";
  }
  return null;
}

export function SecuritySettingsView(props: {
  profile: AccountSecurityProfile;
  sessions: AuthSessionSummary[];
  status: SecuritySettingsStatus;
}) {
  const notice = emailNotice(props.status.email);
  const sessionStatus = sessionNotice(props.status.sessions);

  return (
    <div className={styles.stack}>
      <nav className={styles.subnav} aria-label="Разделы настроек">
        <Link href="/settings">Обзор</Link>
        <Link href="/settings/security" aria-current="page">Безопасность</Link>
        {props.profile.role === "owner" || props.profile.role === "admin" ? (
          <Link href="/settings/team">Команда</Link>
        ) : null}
      </nav>

      <section className={styles.hero} aria-labelledby="security-profile">
        <div>
          <span className={styles.eyebrow}>Аккаунт</span>
          <h2 id="security-profile">{props.profile.displayName ?? "Профиль без имени"}</h2>
          <p>{props.profile.email}</p>
        </div>
        <dl className={styles.profileFacts}>
          <div>
            <dt>Рабочее пространство</dt>
            <dd>{props.profile.workspaceName}</dd>
          </div>
          <div>
            <dt>Роль</dt>
            <dd>{ROLE_LABELS[props.profile.role]}</dd>
          </div>
          <div>
            <dt>Аккаунт создан</dt>
            <dd>{formatDate(props.profile.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.card} aria-labelledby="email-change">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Email для входа</span>
            <h2 id="email-change">Сменить основной адрес</h2>
          </div>
          <span className={styles.verified}>
            {props.profile.emailVerifiedAt ? "Подтверждён" : "Ожидает подтверждения"}
          </span>
        </div>
        <p className={styles.muted}>
          Новый адрес станет основным только после перехода по ссылке из письма.
          На прежний адрес придёт уведомление о запросе.
        </p>
        {notice ? (
          <div className={styles.notice} data-tone={notice.tone} role="status">
            <span>{notice.text}</span>
            {"action" in notice ? (
              <Link href="/login?returnTo=/settings/security">Войти заново</Link>
            ) : null}
          </div>
        ) : null}
        <form action={requestEmailChangeAction} className={styles.inlineForm}>
          <label>
            <span>Новый email</span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              placeholder="name@company.ru"
            />
          </label>
          <button type="submit" className={styles.primaryButton}>
            Отправить подтверждение
          </button>
        </form>
      </section>

      <section className={styles.card} aria-labelledby="active-sessions">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Доступ</span>
            <h2 id="active-sessions">Активные сессии</h2>
          </div>
          <span className={styles.count}>{props.sessions.length}</span>
        </div>
        <p className={styles.muted}>
          Здесь показаны только понятные метки устройства и среды. Неизвестную
          сессию можно завершить сразу.
        </p>
        {sessionStatus ? (
          <div className={styles.notice} data-tone="success" role="status">
            {sessionStatus}
          </div>
        ) : null}
        <ul className={styles.sessionList}>
          {props.sessions.map((session) => (
            <li key={session.id} className={styles.sessionItem}>
              <div className={styles.sessionMark} aria-hidden="true" />
              <div className={styles.sessionCopy}>
                <div className={styles.sessionTitle}>
                  <strong>
                    {[session.browserLabel, session.environmentLabel]
                      .filter(Boolean)
                      .join(" · ") || session.deviceLabel || "Неизвестное устройство"}
                  </strong>
                  {session.current ? <span>Текущая</span> : null}
                </div>
                <p>
                  {session.deviceLabel ?? "Устройство не определено"} ·{" "}
                  {AUTH_METHOD_LABELS[session.authMethod]}
                </p>
                <time dateTime={session.lastSeenAt.toISOString()}>
                  Активность: {formatDate(session.lastSeenAt)}
                </time>
              </div>
              {session.current ? null : (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <button type="submit" className={styles.quietButton}>
                    Завершить
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <div className={styles.actionRow}>
          <form action={endOtherSessionsAction}>
            <button type="submit" className={styles.secondaryButton}>
              Завершить остальные
            </button>
          </form>
          <form action={endCurrentSessionAction}>
            <button type="submit" className={styles.secondaryButton}>
              Выйти на этом устройстве
            </button>
          </form>
          <form action={endAllSessionsAction}>
            <button type="submit" className={styles.dangerButton}>
              Завершить все сессии
            </button>
          </form>
        </div>
      </section>

      <section className={styles.dangerCard} aria-labelledby="delete-account">
        <span className={styles.eyebrow}>Необратимое действие</span>
        <h2 id="delete-account">Удаление аккаунта</h2>
        <p>
          Доступ будет отозван сразу. Рабочие данные перейдут в режим удаления
          по настроенной политике хранения; обязательные платёжные и аудиторские
          записи сохраняются отдельно.
        </p>
        {props.status.deletion ? (
          <div className={styles.notice} data-tone="warning" role="alert">
            {props.status.deletion === "ownership_transfer_required"
              ? "Сначала передайте владение рабочим пространством другому участнику."
              : props.status.deletion === "reauth_required"
                ? "Перед удалением войдите в аккаунт заново."
                : "Запрос не создан. Проверьте подтверждение и повторите попытку."}
          </div>
        ) : null}
        <details className={styles.dangerDisclosure}>
          <summary>Показать форму удаления</summary>
          <form action={deleteAccountAction} className={styles.deleteForm}>
            <label>
              <span>
                Введите <strong>{ACCOUNT_DELETION_CONFIRMATION}</strong>
              </span>
              <input
                name="confirmation"
                required
                autoComplete="off"
                aria-describedby="delete-help"
              />
            </label>
            <small id="delete-help">
              Регистр и пробелы должны совпадать. Отменить запрос после
              подтверждения нельзя.
            </small>
            <button type="submit" className={styles.dangerButton}>
              Запросить удаление
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}
