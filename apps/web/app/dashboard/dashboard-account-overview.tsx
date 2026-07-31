import Link from "next/link";

import { CheckIcon, MailIcon, SearchIcon, TargetIcon } from "../ui/icons";
import styles from "./dashboard-workspace.module.css";

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
      <div className={styles.accountOverviewLead}>
        <span className={styles.accountEyebrow}>Радар возможностей</span>
        <h2 id="account-overview-title" className={styles.accountTitle}>
          {props.agencyName}: фокус на сегодня
        </h2>
        <p className={styles.accountDescription}>
          Сначала разберите компании с сильным сигналом, затем очередь проверки. Состояние профиля и доставки видно рядом, чтобы радар не работал вслепую.
        </p>
        <div className={styles.accountPrimaryActions}>
          <Link href="/leads" className={styles.accountPrimaryAction}>
            Открыть {props.todayLeads} {leadLabel}
          </Link>
          <Link href="/review" className={styles.accountSecondaryAction}>
            Проверить {props.pendingReview}
          </Link>
        </div>
      </div>

      <div className={styles.accountStatusGrid}>
        <article className={styles.accountStatusCard}>
          <SearchIcon className={styles.accountStatusIcon} aria-hidden="true" />
          <span className={styles.accountStatusLabel}>Приоритет сегодня</span>
          <strong>{props.todayLeads}</strong>
          <span>компаний с лучшим сигналом</span>
        </article>

        <article className={styles.accountStatusCard}>
          <TargetIcon className={styles.accountStatusIcon} aria-hidden="true" />
          <span className={styles.accountStatusLabel}>Профиль поиска</span>
          <strong>{props.completionPercent}% готово</strong>
          <Link href="/profile">Уточнить ICP</Link>
        </article>

        <article className={styles.accountStatusCard} data-ready={props.deliveryReady ? "true" : "false"}>
          {props.deliveryReady ? (
            <CheckIcon className={styles.accountStatusIcon} aria-hidden="true" />
          ) : (
            <MailIcon className={styles.accountStatusIcon} aria-hidden="true" />
          )}
          <span className={styles.accountStatusLabel}>Доставка радара</span>
          <strong>{props.deliveryReady ? "Подключена" : "Нужно настроить"}</strong>
          <Link href="/profile#delivery">
            {props.deliveryReady ? "Проверить расписание" : "Настроить доставку"}
          </Link>
        </article>
      </div>
    </section>
  );
}
