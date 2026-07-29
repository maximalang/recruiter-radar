import Link from "next/link";
import type { ReactNode } from "react";

import { BrandLogo } from "../ui/brand-logo";
import styles from "./login.module.css";

export function AuthShell(props: { children: ReactNode }) {
  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        <aside className={styles.story} aria-label="О Recruiter Radar">
          <Link href="/" className={styles.brand}>
            <BrandLogo size="small" tone="dark" />
          </Link>
          <div className={styles.radar} aria-hidden="true">
            <span className={styles.radarCore} />
            <span className={styles.radarSweep} />
          </div>
          <div className={styles.storyCopy}>
            <p className={styles.storyEyebrow}>Сигналы найма для агентств</p>
            <h2 className={styles.storyTitle}>
              От наблюдения
              <br />
              к разговору вовремя
            </h2>
            <p className={styles.storyLead}>
              Recruiter Radar собирает проверяемые сигналы компаний и помогает
              команде видеть, где потребность в найме возникает прямо сейчас.
            </p>
            <ul className={styles.valueList}>
              <li>Доказательства рядом с каждой рекомендацией</li>
              <li>Единый рабочий контекст команды</li>
              <li>Безопасный вход без паролей</li>
            </ul>
          </div>
        </aside>
        <section className={styles.card}>{props.children}</section>
      </div>
    </main>
  );
}
