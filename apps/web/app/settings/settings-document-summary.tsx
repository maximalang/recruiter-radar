import Link from "next/link";
import styles from "./settings-document-summary.module.css";

export default function SettingsDocumentSummary(props: {
  agencyName: string;
  completionPercent: number;
  deliveryEnabled: boolean;
  deliverySchedule: string;
  telegramConnected: boolean;
  emailEnabled: boolean;
  webPushEnabled: boolean;
  authSecurityEnabled: boolean;
}) {
  const deliveryReady = props.deliveryEnabled && (props.telegramConnected || props.emailEnabled || props.webPushEnabled);

  return (
    <div className={styles.overview}>
      <nav className={styles.settingsNav} aria-label="Разделы настроек">
        <Link href="/settings/account">Аккаунт</Link>
        <Link href="/settings/radar">Профиль радара</Link>
        <Link href="/settings/delivery">Доставка</Link>
        {props.authSecurityEnabled ? <Link href="/settings/team">Команда</Link> : null}
        {props.authSecurityEnabled ? <Link href="/settings/security">Безопасность</Link> : null}
        {props.authSecurityEnabled ? <Link href="/settings/access">Доступ и оплата</Link> : null}
      </nav>

      <div className={styles.document}>
        <section className={styles.section}>
          <span className={styles.eyebrow}>Профиль радара</span>
          <h2>{props.agencyName}</h2>
          <p>Роли, отрасли, география, размер компаний и порог сигнала определяют, какие компании попадают в рабочий набор.</p>
          <dl className={styles.factList}>
            <div><dt>Готовность профиля</dt><dd>{props.completionPercent}%</dd></div>
          </dl>
          <Link href="/settings/radar" className={styles.action}>Изменить профиль</Link>
        </section>

        <section className={styles.section}>
          <span className={styles.eyebrow}>Доставка</span>
          <h2>{deliveryReady ? "Доставка настроена" : props.deliveryEnabled ? "Нужен канал доставки" : "Доставка выключена"}</h2>
          <p>{deliveryReady ? props.deliverySchedule : "Подключите хотя бы один канал и задайте расписание получения радара."}</p>
          <dl className={styles.factList}>
            <div><dt>Telegram</dt><dd>{props.telegramConnected ? "подключён" : "нет"}</dd></div>
            <div><dt>Email</dt><dd>{props.emailEnabled ? "включён" : "выключен"}</dd></div>
            <div><dt>Web push</dt><dd>{props.webPushEnabled ? "включён" : "выключен"}</dd></div>
          </dl>
          <Link href="/settings/delivery" className={styles.action}>Настроить доставку</Link>
        </section>

        {props.authSecurityEnabled ? (
          <section className={styles.section}>
            <span className={styles.eyebrow}>Рабочее пространство</span>
            <h2>Доступ и команда</h2>
            <p>Участники, роли, безопасность аккаунта и срок доступа управляются отдельно от профиля радара.</p>
            <div className={styles.inlineLinks}>
              <Link href="/settings/team">Команда</Link>
              <Link href="/settings/security">Безопасность</Link>
              <Link href="/settings/access">Доступ и оплата</Link>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
