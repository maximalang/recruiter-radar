import Link from "next/link";

import { CheckIcon, MailIcon, SearchIcon, TargetIcon } from "../ui/icons";
import styles from "./dashboard-v2.module.css";

export default function DashboardAccountOverview(props: {
  agencyName: string;
  todayLeads: number;
  pendingReview: number;
  completionPercent: number;
  deliveryReady: boolean;
}) {
  const leadLabel = props.todayLeads === 1 ? "компания" : props.todayLeads < 5 ? "компании" : "компаний";

  return (
    <section className={styles.accountOverview} aria-labelledby="account-overview-title">
      <div className={styles.accountOverviewMain}>
        <div className={styles.accountOverviewLead}>
          <span className={styles.accountEyebrow}>Morning Brief · {props.agencyName}</span>
          <h2 id="account-overview-title" className={styles.accountTitle}>
            Сегодня в радаре —{" "}
            <span className={styles.accountTitleAccent}>
              {props.todayLeads} {leadLabel}
            </span>
          </h2>
          <p className={styles.accountDescription}>
            Это не общий список работодателей. Здесь только компании, где свежий hiring-сигнал совпал с профилем агентства и открыл окно для коммерческого разговора.
          </p>
          <div className={styles.accountPrimaryActions}>
            <Link href="/leads" className={styles.accountPrimaryAction}>
              Разобрать возможности
            </Link>
            <Link href="/review" className={styles.accountSecondaryAction}>
              Очередь проверки · {props.pendingReview}
            </Link>
          </div>
        </div>

        <div className={styles.radarStage} aria-hidden="true">
          <div className={styles.radarVisual}>
            <span className={styles.radarRing} />
            <span className={styles.radarCrosshair} />
            <span className={styles.radarSweep} />
            <span className={`${styles.radarPoint} ${styles.radarPointOne}`} />
            <span className={`${styles.radarPoint} ${styles.radarPointTwo}`} />
            <span className={`${styles.radarPoint} ${styles.radarPointThree}`} />
            <span className={styles.radarCore}>
              <strong>{props.todayLeads}</strong>
              <span>окон для контакта</span>
            </span>
          </div>
        </div>
      </div>

      <div className={styles.accountStatusGrid}>
        <article className={styles.accountStatusCard}>
          <span className={styles.accountStatusIconWrap}>
            <SearchIcon className={styles.accountStatusIcon} aria-hidden="true" />
          </span>
          <span className={styles.accountStatusLabel}>Приоритет сегодня</span>
          <strong>{props.todayLeads} {leadLabel}</strong>
          <Link href="/leads" className={styles.statusAction}>Открыть brief</Link>
        </article>

        <article className={styles.accountStatusCard}>
          <span className={styles.accountStatusIconWrap}>
            <TargetIcon className={styles.accountStatusIcon} aria-hidden="true" />
          </span>
          <span className={styles.accountStatusLabel}>Agency DNA</span>
          <strong>{props.completionPercent}% готово</strong>
          <Link href="/profile" className={styles.statusAction}>Уточнить ICP</Link>
        </article>

        <article className={styles.accountStatusCard} data-ready={props.deliveryReady ? "true" : "false"}>
          <span className={styles.accountStatusIconWrap}>
            {props.deliveryReady ? (
              <CheckIcon className={styles.accountStatusIcon} aria-hidden="true" />
            ) : (
              <MailIcon className={styles.accountStatusIcon} aria-hidden="true" />
            )}
          </span>
          <span className={styles.accountStatusLabel}>Доставка радара</span>
          <strong>{props.deliveryReady ? "Подключена" : "Нужна настройка"}</strong>
          <Link href="/profile#delivery" className={styles.statusAction}>
            {props.deliveryReady ? "Проверить расписание" : "Настроить канал"}
          </Link>
        </article>
      </div>
    </section>
  );
}
