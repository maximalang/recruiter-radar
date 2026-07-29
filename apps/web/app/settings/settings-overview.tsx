import Link from "next/link";

import { BellIcon, MailIcon, TargetIcon } from "../ui/icons";
import styles from "./settings-overview.module.css";

export default function SettingsOverview(props: {
  agencyName: string;
  completionPercent: number;
  deliveryEnabled: boolean;
  deliverySchedule: string;
  telegramConnected: boolean;
  emailEnabled: boolean;
  webPushEnabled: boolean;
  authSecurityEnabled: boolean;
}) {
  const deliveryReady = props.deliveryEnabled && (
    props.telegramConnected || props.emailEnabled || props.webPushEnabled
  );

  return (
    <div className={styles.overview}>
      <section className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>Центр настроек</span>
          <h2 className={styles.title}>{props.agencyName}</h2>
          <p>Здесь только состояние аккаунта. Детальные поля открываются в одном редакторе профиля, поэтому настройки не дублируются и не расходятся.</p>
        </div>
        <span className={styles.introStatus}>{props.completionPercent}% готово</span>
      </section>

      <div className={styles.grid}>
        <article className={styles.card}>
          <TargetIcon className={styles.cardIcon} aria-hidden="true" />
          <span className={styles.cardLabel}>Профиль поиска</span>
          <strong>{props.completionPercent}% готово</strong>
          <div className={styles.cardMeta}>
            <span>Роли, отрасли, география, размер компаний и порог сигнала.</span>
          </div>
          <Link href="/profile#agency">Изменить профиль</Link>
        </article>

        <article className={styles.card}>
          <BellIcon className={styles.cardIcon} aria-hidden="true" />
          <span className={styles.cardLabel}>Расписание</span>
          <strong>
            {deliveryReady
              ? "Доставка включена"
              : props.deliveryEnabled
                ? "Доставка ожидает канал"
                : "Доставка выключена"}
          </strong>
          <div className={styles.cardMeta}>
            <span>{deliveryReady ? props.deliverySchedule : "Подключите хотя бы один канал доставки."}</span>
          </div>
          <Link href="/profile#delivery">Настроить расписание</Link>
        </article>

        <article className={styles.card}>
          <MailIcon className={styles.cardIcon} aria-hidden="true" />
          <span className={styles.cardLabel}>Каналы</span>
          <strong>{props.telegramConnected ? "Telegram подключён" : "Telegram не подключён"}</strong>
          <div className={styles.cardMeta}>
            <span>Email: {props.emailEnabled ? "включён" : "выключен"}</span>
            <span>Web push: {props.webPushEnabled ? "включён" : "выключен"}</span>
          </div>
          <Link href="/profile#delivery">Настроить каналы</Link>
        </article>
      </div>
      {props.authSecurityEnabled ? (
        <nav className={styles.accountLinks} aria-label="Доступ к аккаунту">
          <Link href="/settings/security">
            <strong>Безопасность</strong>
            <span>Профиль, email, активные сессии и удаление аккаунта</span>
          </Link>
          <Link href="/settings/team">
            <strong>Команда</strong>
            <span>Участники, приглашения, роли и передача владения</span>
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
