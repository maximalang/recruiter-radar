import Link from "next/link";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../../lib/landing-analytics-contract";
import { ArrowGlyph } from "./brand-glyphs";
import { DEMO_COMPANY, DEMO_EVIDENCE_SOURCES } from "./landing-copy";
import sceneStyles from "./detection-scene.module.css";

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
      className={sceneStyles.hero}
      aria-labelledby="detection-title"
      data-theme="inverse"
      data-header-tone="dark"
      data-hero-layout="company-brief"
      data-art-direction="evidence-first"
      data-payment-offer={props.paymentConfigured ? "7 дней · 990 ₽" : "7 дней · заявка без списания"}
    >
      <div className={sceneStyles.heroInner}>
        <div className={sceneStyles.heroHeading} data-hero-copy>
          <div>
            <p className={sceneStyles.serviceLabel}>Клиентский радар для рекрутинговых агентств</p>
            <h1 id="detection-title" className={sceneStyles.title} data-hero-title>
              Находите компании, которым стоит написать сейчас.
            </h1>
          </div>
          <div className={sceneStyles.promiseColumn}>
            <p className={sceneStyles.promise} data-hero-description>
              Recruiter Radar замечает свежие изменения в найме, проверяет их по источникам
              и показывает конкретный повод для первого контакта.
            </p>
            <div className={sceneStyles.heroFooter} data-hero-actions>
              <div className={sceneStyles.actions}>
                <a
                  className={sceneStyles.primaryCta}
                  href={props.previewHref}
                  data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
                  data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
                >
                  Посмотреть пример <ArrowGlyph />
                </a>
                <Link className={sceneStyles.loginLink} href="/login?returnTo=%2Fdashboard">Войти</Link>
              </div>
              <p className={sceneStyles.trustLine} data-hero-trust-line>
                Проверяемые факты · официальный контакт · без авторассылки
              </p>
            </div>
          </div>
        </div>

        <div className={sceneStyles.companyBrief} data-hero-company-brief="true">
          <div
            className={sceneStyles.resolutionChain}
            data-hero-visual
            data-mobile-hero-signal
            aria-label="От сигнала к решению"
          >
            <article className={`${sceneStyles.node} ${sceneStyles.signalNode}`} data-hero-stage="signal">
              <span className={sceneStyles.stageLabel}>Сигнал</span>
              <small>Рекомендация / сегодня · изменение в компании</small>
              <h2>{DEMO_COMPANY.name}</h2>
              <div className={sceneStyles.whyNow}>
                <span>Почему сейчас</span>
                <strong>{DEMO_COMPANY.signal}</strong>
              </div>
              <p>{DEMO_COMPANY.location} · {DEMO_COMPANY.industry}</p>
            </article>

            <span className={sceneStyles.chainArrow} aria-hidden="true"><ArrowGlyph size={18} /></span>

            <article
              className={`${sceneStyles.node} ${sceneStyles.evidenceNode}`}
              data-hero-stage="evidence"
              aria-label="Подтверждения"
            >
              <span className={sceneStyles.stageLabel}>Подтверждение</span>
              <ul>
                <li>
                  <small>{strongestEvidence.eventDate} · {strongestEvidence.source}</small>
                  <strong>{strongestEvidence.fact}</strong>
                </li>
              </ul>
              <div className={sceneStyles.evidenceSummary}>
                <strong>+2 подтверждения</strong>
                <span>Даты и источники — ниже</span>
              </div>
            </article>

            <span className={sceneStyles.chainArrow} aria-hidden="true"><ArrowGlyph size={18} /></span>

            <article className={`${sceneStyles.node} ${sceneStyles.decisionNode}`} data-hero-stage="decision">
              <span className={sceneStyles.stageLabel}>Решение</span>
              <div className={sceneStyles.confidenceBlock}>
                <span>Уверенность</span>
                <strong>{capitalize(confidenceText)}</strong>
                <small>Класс {confidenceGrade} · {DEMO_COMPANY.score} / 100</small>
              </div>
              <div className={sceneStyles.nextMove}>
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
