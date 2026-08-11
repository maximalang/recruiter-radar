import Link from "next/link";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { ArrowGlyph } from "./brand-glyphs";
import HeroRadar from "./hero-radar";
import sceneStyles from "./detection-scene.module.css";

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
      className={sceneStyles.section}
      aria-labelledby="detection-title"
      data-header-tone="dark"
      data-hero-layout="ambient-radar"
    >
      <div className={sceneStyles.fieldFigure} data-hero-visual data-mobile-hero-signal>
        <HeroRadar />
      </div>

      <div className={sceneStyles.kicker}>
        <span className={sceneStyles.kickerRule} aria-hidden="true" />
        <span>Радар клиентских возможностей</span>
        <span className={sceneStyles.kickerMeta}>Сигнал → факт → повод</span>
      </div>

      <div className={sceneStyles.copy} data-hero-copy>
        <p className={sceneStyles.serviceLabel}>Поиск новых клиентов для рекрутинговых агентств</p>
        <h1 id="detection-title" className={sceneStyles.title} data-hero-title>
          Компании, которым стоит написать сегодня.
        </h1>
        <p className={sceneStyles.description} data-hero-description>
          Recruiter Radar отслеживает свежие изменения в найме и показывает, где появился реальный повод предложить подбор — с фактами и источниками по каждой компании.
        </p>
        <div className={sceneStyles.actions} data-hero-actions>
          <a
            href={previewHref}
            className={sceneStyles.primaryButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
          >
            Посмотреть пример <ArrowGlyph />
          </a>
          <span className={sceneStyles.actionHint}>Настройте нишу и географию · без регистрации</span>
        </div>
        <Link href="/login?returnTo=%2Fdashboard" className={sceneStyles.loginLink}>Уже есть доступ? Войти</Link>
        <p className={sceneStyles.microcopy} data-hero-trust-line>
          {paymentConfigured
            ? "7 дней · 990 ₽ · без автопродления · сообщения отправляете вы"
            : "7 дней · заявка без списания · сообщения отправляете вы"}
        </p>
      </div>
    </section>
  );
}
