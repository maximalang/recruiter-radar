import Link from "next/link";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../../lib/landing-analytics-contract";
import { ArrowGlyph } from "./brand-glyphs";
import { DEMO_COMPANY, DEMO_EVIDENCE_SOURCES } from "./landing-copy";
import styles from "./detection-scene.module.css";

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

export default function DetectionScene(props: { previewHref: string; paymentConfigured: boolean }) {
  const strongestEvidence = DEMO_EVIDENCE_SOURCES[0];
  const [confidenceGrade = "A", confidenceText = "высокая"] = DEMO_COMPANY.confidence
    .split("/")
    .map((part) => part.trim());

  return (
    <section
      id="scene-detection"
      className={styles.hero}
      aria-labelledby="detection-title"
      data-header-tone="dark"
      data-hero-layout="company-brief"
      data-art-direction="evidence-first"
      data-payment-offer={props.paymentConfigured ? "7 дней · 990 ₽" : "7 дней · заявка без списания"}
    >
      <div className={styles.heroInner}>
        <div className={styles.heroHeading} data-hero-copy>
          <div>
            <p className={styles.serviceLabel}>Клиентский радар для рекрутинговых агентств</p>
            <h1 id="detection-title" className={styles.title} data-hero-title>
              Находите компании, которым стоит написать сейчас.
            </h1>
          </div>
          <div className={styles.promiseColumn}>
            <p className={styles.promise} data-hero-description>
              Recruiter Radar замечает свежие изменения в найме, проверяет их по источникам
              и показывает конкретный повод для первого контакта.
            </p>
            <div className={styles.heroFooter} data-hero-actions>
              <div className={styles.actions}>
                <a
                  className={styles.primaryCta}
                  href={props.previewHref}
                  data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
                  data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
                >
                  Посмотреть пример <ArrowGlyph />
                </a>
                <Link className={styles.loginLink} href="/login?returnTo=%2Fdashboard">Войти</Link>
              </div>
              <p className={styles.trustLine} data-hero-trust-line>
                Проверяемые факты · официальный контакт · без авторассылки
              </p>
            </div>
          </div>
        </div>

        <div className={styles.companyBrief} data-hero-company-brief="true">
          <div
            className={styles.resolutionChain}
            data-hero-visual
            data-mobile-hero-signal
            aria-label="От сигнала к решению"
          >
            <article className={`${styles.node} ${styles.signalNode}`} data-hero-stage="signal">
              <span className={styles.stageLabel}>Сигнал</span>
              <small>Сегодня · изменение в компании</small>
              <h2>{DEMO_COMPANY.name}</h2>
              <div className={styles.whyNow}>
                <span>Почему сейчас</span>
                <strong>{DEMO_COMPANY.signal}</strong>
              </div>
              <p>{DEMO_COMPANY.location} · {DEMO_COMPANY.industry}</p>
            </article>

            <span className={styles.chainArrow} aria-hidden="true"><ArrowGlyph size={18} /></span>

            <article className={`${styles.node} ${styles.evidenceNode}`} data-hero-stage="evidence">
              <span className={styles.stageLabel}>Подтверждение</span>
              <ul>
                <li>
                  <small>{strongestEvidence.eventDate} · {strongestEvidence.source}</small>
                  <strong>{strongestEvidence.fact}</strong>
                </li>
              </ul>
              <div className={styles.evidenceSummary}>
                <strong>+2 подтверждения</strong>
                <span>Даты и источники — ниже</span>
              </div>
            </article>

            <span className={styles.chainArrow} aria-hidden="true"><ArrowGlyph size={18} /></span>

            <article className={`${styles.node} ${styles.decisionNode}`} data-hero-stage="decision">
              <span className={styles.stageLabel}>Решение</span>
              <div className={styles.confidenceBlock}>
                <span>Уверенность</span>
                <strong>{capitalize(confidenceText)}</strong>
                <small>Класс {confidenceGrade} · {DEMO_COMPANY.score} / 100</small>
              </div>
              <div className={styles.nextMove}>
                <span>Следующий ход</span>
                <strong>{DEMO_COMPANY.opener}</strong>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
