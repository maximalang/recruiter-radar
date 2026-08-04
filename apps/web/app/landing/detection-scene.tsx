import Link from "next/link";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { DEMO_COMPANY } from "./landing-copy";
import { ArrowGlyph, RadarField, SignalGlyph } from "./brand-glyphs";
import polish from "./landing-polish.module.css";
import styles from "./landing.module.css";

export default function DetectionScene({ previewHref }: { previewHref: string }) {
  return (
    <section id="scene-detection" className={`${styles.scene} ${styles.detectionScene}`} aria-labelledby="detection-title">
      <div className={styles.detectionField} aria-hidden="true">
        <RadarField />
      </div>
      <div className={styles.sceneKicker}>
        <span className={styles.kickerRule} aria-hidden="true" />
        <span>RADAR / SIGNAL LOCK</span>
        <span className={styles.kickerMeta}>01 — Обзор</span>
      </div>
      <div className={styles.detectionCopy}>
        <p className={styles.serviceLabel}>Клиентский радар для рекрутинговых агентств</p>
        <h1 id="detection-title" className={styles.displayTitle}>
          Кому написать сегодня — <em>видно по сигналам.</em>
        </h1>
        <p className={styles.heroDescription}>
          Recruiter Radar отслеживает hiring signals российских компаний и каждое утро собирает короткий список: кому писать, почему сейчас и на какие факты сослаться.
        </p>
        <div className={styles.heroActions}>
          <a
            href={previewHref}
            className={styles.primaryButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
          >
            Собрать мой радар <ArrowGlyph />
          </a>
          <a
            href="#scene-timeline"
            className={styles.textButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewResultsClicked}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroSecondary}
          >
            Как строится приоритет <ArrowGlyph className={styles.downArrow} />
          </a>
        </div>
        <p className={styles.microcopy}>Пилот на 7 дней · без автопродления · отправка сообщений только вручную</p>

        <dl className={polish.outcomeRail} aria-label="Что агентство получает от Recruiter Radar">
          <div>
            <dt>Кому писать</dt>
            <dd>Короткая очередь компаний вместо бесконечной базы.</dd>
          </div>
          <div>
            <dt>Почему сейчас</dt>
            <dd>Сигналы, даты и источники рядом с оценкой.</dd>
          </div>
          <div>
            <dt>С каким поводом</dt>
            <dd>Готовый угол разговора без автоматического спама.</dd>
          </div>
        </dl>
      </div>

      <div className={styles.detectionLock} aria-label={`Новый сигнал: ${DEMO_COMPANY.signal}`}>
        <SignalGlyph size={76} />
        <div className={styles.lockCopy}>
          <span className={styles.signalStatus}><i aria-hidden="true" /> новый сигнал · 2 часа назад</span>
          <strong>{DEMO_COMPANY.signal}</strong>
          <span>{DEMO_COMPANY.name} · {DEMO_COMPANY.location}</span>
        </div>
        <Link href="#scene-workspace" className={styles.lockArrow} aria-label="Открыть компанию в рабочем радаре"><ArrowGlyph className={styles.diagonalArrow} size={20} /></Link>
      </div>

      <div className={styles.detectionFooter}>
        <span>Сигнал → Доказательство → Действие</span>
        <a href="#scene-workspace">Сначала посмотрите сам продукт <ArrowGlyph className={styles.downArrow} /></a>
      </div>
    </section>
  );
}