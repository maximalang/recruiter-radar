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
            <BrandLogo size="small" />
          </Link>
          <div className={styles.compass} data-auth-compass="true" aria-hidden="true">
            <span className={styles.compassRing} />
            <span className={styles.compassRing} />
            <span className={styles.compassRing} />
            <span className={styles.signalCluster} data-signal-cluster="primary" />
            <span className={styles.signalCluster} data-signal-cluster="secondary" />
          </div>
          <div className={styles.storyCopy}>
            <p className={styles.storyEyebrow}>Recruiter Radar</p>
            <h2 className={styles.storyTitle}>Сигнал → доказательство → действие</h2>
            <p className={styles.storyLead}>Рабочий контекст агентства остаётся рядом с подтверждённым следующим ходом.</p>
          </div>
        </aside>
        <section className={styles.card}>{props.children}</section>
      </div>
    </main>
  );
}
