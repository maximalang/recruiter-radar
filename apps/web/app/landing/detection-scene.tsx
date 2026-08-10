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
      <div className={sceneStyles.fieldFigure} data-hero-visual>
        <HeroRadar />
      </div>

      <div className={sceneStyles.kicker}>
        <span className={sceneStyles.kickerRule} aria-hidden="true" />
        <span>Evidence-first клиентский радар</span>
        <span className={sceneStyles.kickerMeta}>Сигнал → компания → возможность</span>
      </div>

      <div className={sceneStyles.copy} data-hero-copy>
        <p className={sceneStyles.serviceLabel}>Клиентские возможности для рекрутинговых агентств</p>
        <h1 id="detection-title" className={sceneStyles.title} data-hero-title>
          Компании, которым стоит написать сегодня.
        </h1>
        <p className={sceneStyles.description} data-hero-description>
          Recruiter Radar связывает сигналы найма с компаниями и показывает короткий приоритет: что изменилось, насколько сигнал надёжен и на какие факты опереться.
        </p>
        <div className={sceneStyles.actions} data-hero-actions>
          <a
            href={previewHref}
            className={sceneStyles.primaryButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
          >
            Посмотреть возможности <ArrowGlyph />
          </a>
        </div>
        <Link href="/login?returnTo=%2Fdashboard" className={sceneStyles.loginLink}>Уже есть доступ? Войти</Link>
        <p className={sceneStyles.microcopy} data-hero-trust-line>
          {paymentConfigured
            ? "7 дней · разовая оплата · обращения компаниям отправляете только вы"
            : "7 дней · заявка без списания · обращения компаниям отправляете только вы"}
        </p>
      </div>
    </section>
  );
}
