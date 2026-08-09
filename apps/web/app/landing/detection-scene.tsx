import Link from "next/link";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { ArrowGlyph, SignalGlyph } from "./brand-glyphs";
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
      className={`${styles.scene} ${sceneStyles.section}`}
      aria-labelledby="detection-title"
      data-header-tone="dark"
      data-hero-layout="balanced-grid"
    >
      <div className={sceneStyles.mobileSignal} data-mobile-hero-signal="true" aria-hidden="true">
        <span className={sceneStyles.mobileRing} />
        <span className={sceneStyles.mobileRing} />
        <span className={sceneStyles.mobileConstellation}><i /><i /><i /><i /><i /></span>
      </div>

      <div className={sceneStyles.fieldFigure} data-hero-visual>
        <HeroInstrument
          companyName={DEMO_COMPANY.name}
          signalLabel={DEMO_COMPANY.signal}
          score={DEMO_COMPANY.score}
          confidence={DEMO_COMPANY.confidence}
        />

        <article className={sceneStyles.analysisFrame} aria-label={`Новый сигнал: ${DEMO_COMPANY.signal}`} data-hero-signal-card>
          <div className={sceneStyles.lockMarker}><SignalGlyph size={54} /></div>
          <div className={sceneStyles.lockCopy}>
            <span className={sceneStyles.signalStatus}><i aria-hidden="true" /> приоритет обновлён · {DEMO_COMPANY.freshness}</span>
            <strong>{DEMO_COMPANY.name}</strong>
            <p>{DEMO_COMPANY.change}</p>
            <dl className={sceneStyles.lockMetrics}>
              <div><dt>Свежесть</dt><dd>{DEMO_COMPANY.freshness}</dd></div>
              <div><dt>Уверенность</dt><dd>{DEMO_COMPANY.confidence}</dd></div>
            </dl>
            <small><b>Почему сейчас:</b> {DEMO_COMPANY.whyNow}</small>
          </div>
          <Link href="#scene-timeline" className={sceneStyles.lockArrow} aria-label="Разобрать сигнал компании">
            <ArrowGlyph className={styles.diagonalArrow} size={20} />
          </Link>
        </article>
      </div>

      <div className={sceneStyles.kicker}>
        <span className={sceneStyles.kickerRule} aria-hidden="true" />
        <span>Evidence-first клиентский радар</span>
        <span className={sceneStyles.kickerMeta}>01 — Сигнал</span>
      </div>

      <div className={sceneStyles.copy} data-hero-copy>
        <p className={sceneStyles.serviceLabel}>Клиентские возможности для рекрутинговых агентств</p>
        <h1 id="detection-title" className={sceneStyles.title} data-hero-title>
          Компании, которым стоит написать сегодня.
        </h1>
        <p className={sceneStyles.description} data-hero-description>
          Recruiter Radar собирает сигналы найма, связывает их с конкретными компаниями и показывает короткий приоритетный список: что изменилось, насколько сигнал надёжен и на какие факты можно сослаться в первом контакте.
        </p>
        <div className={sceneStyles.actions} data-hero-actions>
          <a
            href={previewHref}
            className={sceneStyles.primaryButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
          >
            Посмотреть пример радара <ArrowGlyph />
          </a>
          <a
            href="#scene-timeline"
            className={sceneStyles.textButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewResultsClicked}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroSecondary}
          >
            Как формируется приоритет <ArrowGlyph className={styles.downArrow} />
          </a>
        </div>
        <p className={sceneStyles.microcopy} data-hero-trust-line>
          {paymentConfigured
            ? "7 дней · разовая оплата · обращения компаниям отправляете только вы"
            : "7 дней · заявка без списания · обращения компаниям отправляете только вы"}
        </p>
      </div>
    </section>
  );
}
