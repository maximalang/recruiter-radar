import Link from "next/link";
import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { ArrowGlyph } from "./brand-glyphs";
import { DEMO_COMPANY, DEMO_EVIDENCE_SOURCES } from "./landing-copy";
import sceneStyles from "./detection-scene.module.css";

export default function DetectionScene({ previewHref, paymentConfigured }: { previewHref: string; paymentConfigured: boolean }) {
  return (
    <section id="scene-detection" className={sceneStyles.section} aria-labelledby="detection-title" data-header-tone="dark" data-hero-layout="company-brief" data-theme="inverse">
      <div className={sceneStyles.copy} data-hero-copy>
        <p className={sceneStyles.serviceLabel}>Клиентский радар для рекрутинговых агентств</p>
        <h1 id="detection-title" className={sceneStyles.title} data-hero-title>Находите компании, которым стоит написать сейчас.</h1>
        <p className={sceneStyles.description} data-hero-description>
          Recruiter Radar замечает свежие изменения в найме, проверяет их по публичным источникам и показывает, с каким поводом выйти на компанию.
        </p>
        <div className={sceneStyles.actions} data-hero-actions>
          <a href={previewHref} className={sceneStyles.primaryButton} data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted} data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}>
            Посмотреть пример <ArrowGlyph />
          </a>
          <Link href="/login?returnTo=%2Fdashboard" className={sceneStyles.loginLink}>Войти</Link>
        </div>
        <p className={sceneStyles.microcopy} data-hero-trust-line>
          Подтверждённые факты · Корпоративные пути контакта · Сообщения отправляете вы
        </p>
        <p className={sceneStyles.pilotLine}>{paymentConfigured ? "7 дней · 990 ₽ · без автопродления" : "7 дней · заявка без списания"}</p>
      </div>

      <article className={sceneStyles.companyBrief} data-hero-visual data-mobile-hero-signal data-hero-company-brief="true" aria-label={`Пример рекомендации: ${DEMO_COMPANY.name}`}>
        <header className={sceneStyles.briefHeader}>
          <span>Рекомендация / сегодня</span>
          <strong>Высокая уверенность</strong>
        </header>
        <div className={sceneStyles.companyIdentity}>
          <span>01</span>
          <div><strong>{DEMO_COMPANY.name}</strong><small>{DEMO_COMPANY.location} · инженерный подбор</small></div>
        </div>
        <div className={sceneStyles.whyNow}>
          <span>Почему сейчас</span>
          <strong>{DEMO_COMPANY.whyNow}</strong>
        </div>
        <div className={sceneStyles.evidenceBlock}>
          <span>Подтверждения</span>
          <ul>{DEMO_EVIDENCE_SOURCES.map((item) => <li key={item.source}><span>{item.source}</span><strong>{item.fact}</strong><small>{item.eventDate}</small></li>)}</ul>
        </div>
        <div className={sceneStyles.nextMove}>
          <span>Следующий ход</span>
          <strong>Предложить точечный подбор по инженерным ролям.</strong>
        </div>
        <div className={sceneStyles.briefFooter}>Корпоративная карьерная страница · без автоотправки</div>
      </article>
    </section>
  );
}
