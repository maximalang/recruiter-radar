import Link from "next/link";
import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { ArrowGlyph } from "./brand-glyphs";
import sceneStyles from "./detection-scene.module.css";

export default function DetectionScene({ previewHref, paymentConfigured }: { previewHref: string; paymentConfigured: boolean }) {
  return (
    <section id="scene-detection" className={sceneStyles.section} aria-labelledby="detection-title" data-header-tone="light" data-hero-layout="signal-spine">
      <div className={sceneStyles.copy} data-hero-copy>
        <p className={sceneStyles.serviceLabel}>Радар клиентских возможностей для рекрутинговых агентств</p>
        <h1 id="detection-title" className={sceneStyles.title} data-hero-title>Компании, которым стоит написать сегодня.</h1>
        <p className={sceneStyles.description} data-hero-description>
          Recruiter Radar замечает изменения в найме, показывает почему момент важен и прикладывает подтверждения по каждой компании.
        </p>
        <div className={sceneStyles.actions} data-hero-actions>
          <a href={previewHref} className={sceneStyles.primaryButton} data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted} data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}>
            Посмотреть пример <ArrowGlyph />
          </a>
          <Link href="/login?returnTo=%2Fdashboard" className={sceneStyles.loginLink}>Войти</Link>
        </div>
        <p className={sceneStyles.microcopy} data-hero-trust-line>
          {paymentConfigured ? "7 дней · 990 ₽ · без автопродления" : "7 дней · заявка без списания"}
        </p>
      </div>

      <div className={sceneStyles.signalSpine} data-hero-visual data-mobile-hero-signal aria-label="Пример пути сигнала">
        <div className={sceneStyles.signalStep}><i aria-hidden="true" /><span>Компания</span><strong>СеверСталь</strong></div>
        <div className={sceneStyles.signalStep}><i aria-hidden="true" /><span>Почему сейчас</span><strong>Открыли 14 вакансий за 9 дней</strong></div>
        <div className={sceneStyles.signalStep}><i aria-hidden="true" /><span>Подтверждения</span><strong>hh.ru · сегодня<br />career page · вчера</strong></div>
        <div className={sceneStyles.signalStep}><i aria-hidden="true" /><span>Следующий ход</span><strong>Написать руководителю подбора</strong></div>
      </div>
    </section>
  );
}
