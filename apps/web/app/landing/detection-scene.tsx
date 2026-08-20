import Link from "next/link";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { ArrowGlyph } from "./brand-glyphs";
import { DEMO_COMPANY, DEMO_EVIDENCE_SOURCES } from "./landing-copy";
import sceneStyles from "./detection-scene.module.css";

export default function DetectionScene({ previewHref, paymentConfigured }: { previewHref: string; paymentConfigured: boolean }) {
  return (
    <section
      id="scene-detection"
      className={sceneStyles.section}
      aria-labelledby="detection-title"
      data-header-tone="dark"
      data-hero-layout="company-brief"
      data-art-direction="evidence-first"
      data-payment-ready={paymentConfigured || undefined}
      data-payment-offer={paymentConfigured ? "7 дней · 990 ₽" : "7 дней · заявка без списания"}
      data-theme="inverse"
    >
      <div className={sceneStyles.heroInner}>
        <div className={sceneStyles.heroHeading} data-hero-copy>
          <div>
            <p className={sceneStyles.serviceLabel}>Клиентский радар для рекрутинговых агентств</p>
            <h1 id="detection-title" className={sceneStyles.title} data-hero-title>
              Находите компании, которым стоит написать сейчас.
            </h1>
          </div>
          <p className={sceneStyles.description} data-hero-description>
            Recruiter Radar замечает свежие изменения в найме, проверяет их по источникам и показывает конкретный повод для первого контакта.
          </p>
        </div>

        <div className={sceneStyles.companyBrief}>
          <div
            className={sceneStyles.resolutionChain}
            data-hero-visual
            data-mobile-hero-signal
            data-hero-company-brief="true"
            aria-label={`Пример рекомендации: ${DEMO_COMPANY.name}`}
          >
            <article className={`${sceneStyles.chainNode} ${sceneStyles.companyNode}`}>
              <span className={sceneStyles.nodeLabel}>Рекомендация / сегодня · изменение в компании</span>
              <h2>{DEMO_COMPANY.name}</h2>
              <span className={sceneStyles.whyLabel}>Почему сейчас</span>
              <strong>{DEMO_COMPANY.signal}.</strong>
              <small>{DEMO_COMPANY.location} · {DEMO_COMPANY.industry}</small>
            </article>

            <span className={sceneStyles.chainArrow} aria-hidden="true">→</span>

            <article className={`${sceneStyles.chainNode} ${sceneStyles.evidenceNode}`}>
              <span className={sceneStyles.nodeLabel}>Подтверждения</span>
              <ul>
                {DEMO_EVIDENCE_SOURCES.map((item) => (
                  <li key={item.source}>
                    <span>{item.eventDate} · {item.source}</span>
                    <strong>{item.fact}</strong>
                  </li>
                ))}
              </ul>
            </article>

            <span className={sceneStyles.chainArrow} aria-hidden="true">→</span>

            <article className={`${sceneStyles.chainNode} ${sceneStyles.confidenceNode}`}>
              <span className={sceneStyles.nodeLabel}>Уровень подтверждения</span>
              <strong className={sceneStyles.confidenceValue}>HIGH</strong>
              <small>{DEMO_COMPANY.confidence} · {DEMO_COMPANY.score} / 100</small>
            </article>

            <span className={sceneStyles.chainArrow} aria-hidden="true">→</span>

            <article className={`${sceneStyles.chainNode} ${sceneStyles.moveNode}`}>
              <span className={sceneStyles.nodeLabel}>Следующий ход</span>
              <strong>{DEMO_COMPANY.opener}</strong>
            </article>
          </div>
        </div>

        <div className={sceneStyles.heroFooter}>
          <div className={sceneStyles.actions} data-hero-actions>
            <a
              href={previewHref}
              className={sceneStyles.primaryButton}
              data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
              data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
            >
              Посмотреть пример <ArrowGlyph />
            </a>
            <Link href="/login?returnTo=%2Fdashboard" className={sceneStyles.loginLink}>Войти</Link>
          </div>
          <p
            className={sceneStyles.microcopy}
            data-hero-trust-line
            data-manual-outreach-label="Сообщения отправляете вы"
          >
            Проверяемые факты · официальный контакт · без авторассылки
          </p>
        </div>
      </div>
    </section>
  );
}
