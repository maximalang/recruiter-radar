import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "../ui/brand-logo";
import styles from "./login.module.css";

export function AuthShell(props: { children: ReactNode }) {
  return (
    <main className={styles.shell} data-ui-system="recruiter-radar">
      <div className={styles.frame}>
        <aside className={styles.story} data-theme="inverse" aria-label="О Recruiter Radar">
          <Link href="/" className={styles.brand}>
            <BrandLogo size="small" tone="dark" />
          </Link>
          <div className={styles.compass} data-auth-compass="true" aria-hidden="true">
            <span className={styles.compassRing} />
            <span className={styles.compassRing} />
            <span className={styles.compassRing} />
            <span className={styles.signalCluster} data-signal-cluster="primary" />
            <span className={styles.signalCluster} data-signal-cluster="secondary" />
          </div>
          <div className={styles.storyCopy}>
            <p className={styles.storyEyebrow}>Рабочий контекст агентства</p>
            <h2 className={styles.storyTitle}>Signal → evidence → action</h2>
            <p className={styles.storyLead}>Hiring signals, доказательства и история работы остаются в одном спокойном workspace.</p>
            <ul className={styles.valueList}>
              <li>Почему сейчас — до агрегированного score</li>
              <li>Доказательства рядом с рекомендацией</li>
              <li>Безопасный вход без паролей</li>
            </ul>
          </div>
        </aside>
        <section className={styles.card}>{props.children}</section>
      </div>
    </main>
  );
}
