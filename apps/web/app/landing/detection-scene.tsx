import Link from "next/link";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { ArrowGlyph, SignalGlyph } from "./brand-glyphs";
import responsiveStyles from "./detection-responsive.module.css";
import sceneStyles from "./detection-scene.module.css";
import HeroInstrument from "./hero-instrument";
import { DEMO_COMPANY } from "./landing-copy";
import styles from "./landing.module.css";

export default function DetectionScene({
  previewHref,
  paymentConfigured,
}: {
  previewHref: string;
  paymentConfigured: boolean;
}) {
  return (
    <section
      id="scene-detection"
      className={`${styles.scene} ${styles.detectionScene} ${sceneStyles.section}`}
      aria-labelledby="detection-title"
      data-header-tone="dark"
      data-hero-layout="balanced-grid"
    >
      <div className={`${styles.detectionField} ${sceneStyles.fieldFigure} ${responsiveStyles.viewportSafeField}`}>
        <HeroInstrument
          companyName={DEMO_COMPANY.name}
          signalLabel={DEMO_COMPANY.signal}
          score={DEMO_COMPANY.score}
          confidence={DEMO_COMPANY.confidence}
          freshness={DEMO_COMPANY.freshness}
        />
      </div>

      <div className={styles.sceneKicker}>
        <span className={styles.kickerRule} aria-hidden="true" />
        <span>Evidence-first клиентский радар</span>
        <span className={styles.kickerMeta}>01 — Сигнал</span>
      </div>

      <div className={`${styles.detectionCopy} ${sceneStyles.copy}`}>
        <p className={styles.serviceLabel}>Клиентские возможности для рекрутинговых агентств</p>
        <h1 id="detection-title" className={`${styles.displayTitle} ${sceneStyles.title}`}>
          Компании, которым стоит написать сегодня.
        </h1>
        <p className={styles.heroDescription}>
          Recruiter Radar собирает сигналы найма, связывает их с конкретными компаниями и показывает короткий приоритетный список: что изменилось, насколько сигнал надёжен и на какие факты можно сослаться в первом контакте.
        </p>
        <div className={styles.heroActions}>
          <a
            href={previewHref}
            className={styles.primaryButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
          >
            Посмотреть пример радара <ArrowGlyph />
          </a>
          <a
            href="#scene-timeline"
            className={styles.textButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewResultsClicked}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroSecondary}
          >
            Как формируется приоритет <ArrowGlyph className={styles.downArrow} />
          </a>
        </div>
        <p className={styles.microcopy} data-hero-trust-line>
          {paymentConfigured
            ? "7 дней · разовая оплата · обращения компаниям отправляете только вы"
            : "7 дней · заявка без списания · обращения компаниям отправляете только вы"}
        </p>
      </div>

      <article className={`${styles.detectionLock} ${sceneStyles.analysisFrame}`} aria-label={`Новый сигнал: ${DEMO_COMPANY.signal}`}>
        <div className={styles.lockMarker}><SignalGlyph size={54} /></div>
        <div className={styles.lockCopy}>
          <span className={styles.signalStatus}><i aria-hidden="true" /> приоритет обновлён · {DEMO_COMPANY.freshness}</span>
          <strong>{DEMO_COMPANY.name}</strong>
          <p>{DEMO_COMPANY.change}</p>
          <dl className={styles.lockMetrics}>
            <div><dt>Свежесть</dt><dd>{DEMO_COMPANY.freshness}</dd></div>
            <div><dt>Уверенность</dt><dd>{DEMO_COMPANY.confidence}</dd></div>
          </dl>
          <small><b>Почему сейчас:</b> {DEMO_COMPANY.whyNow}</small>
        </div>
        <Link href="#scene-timeline" className={styles.lockArrow} aria-label="Разобрать сигнал компании">
          <ArrowGlyph className={styles.diagonalArrow} size={20} />
        </Link>
      </article>

      <div className={`${styles.detectionFooter} ${sceneStyles.footer}`}>
        <span>Сигнал → Проверка → Приоритет → Обращение</span>
        <a href="#scene-workspace">Сразу открыть продукт <ArrowGlyph className={styles.downArrow} /></a>
      </div>
    </section>
  );
}
