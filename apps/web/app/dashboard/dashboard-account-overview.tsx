import Link from "next/link";
import styles from "./dashboard-workspace.module.css";

export default function DashboardAccountOverview(props: {
  agencyName: string;
  todayLeads: number;
  pendingReview: number;
  completionPercent: number;
  deliveryReady: boolean;
}) {
  return (
    <section className={styles.accountOverview} aria-labelledby="account-overview-title">
      <div className={styles.accountOverviewLead}>
        <span className={styles.accountEyebrow}>Фокус на сегодня</span>
        <h2 id="account-overview-title" className={styles.accountTitle}>{props.agencyName}</h2>
        <p className={styles.accountDescription}>
          {props.todayLeads} возможностей в приоритетном наборе · {props.pendingReview} требуют проверки
        </p>
      </div>
      <div className={styles.accountStatusStrip} aria-label="Состояние рабочего контура">
        <Link href="/leads" className={styles.statusFact}>
          <span>Возможности</span><strong>{props.todayLeads}</strong>
        </Link>
        <Link href="/review" className={styles.statusFact}>
          <span>На проверке</span><strong>{props.pendingReview}</strong>
        </Link>
        <Link href="/settings/radar" className={styles.statusFact}>
          <span>Профиль</span><strong>{props.completionPercent}%</strong>
        </Link>
        <Link href="/settings/delivery" className={styles.statusFact}>
          <span>Доставка</span><strong>{props.deliveryReady ? "готова" : "настроить"}</strong>
        </Link>
      </div>
    </section>
  );
}
