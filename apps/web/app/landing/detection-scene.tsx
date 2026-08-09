import Link from "next/link";

import { LANDING_ANALYTICS_CONTEXT, LANDING_ANALYTICS_EVENT } from "../../lib/landing-analytics-contract";
import { ArrowGlyph } from "./brand-glyphs";
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
      <div className={sceneStyles.mobileSignal} data-mobile-hero-signal="true" aria-hidden="true">
        <span className={sceneStyles.mobileRing} />
        <span className={sceneStyles.mobileRing} />
        <span className={sceneStyles.mobileConstellation}><i /><i /><i /><i /><i /></span>
      </div>

      <div className={sceneStyles.fieldFigure} data-hero-visual aria-hidden="true">
        <span className={sceneStyles.ambientRing} />
        <span className={sceneStyles.ambientRing} />
        <span className={sceneStyles.ambientRing} />
        <span className={sceneStyles.ambientAxis} />
        <span className={sceneStyles.ambientNode} />
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
          Recruiter Radar собирает сигналы найма, связывает их с конкретными компаниями и показывает короткий приоритетный список: что изменилось, насколько сигнал надёжен и на какие факты можно сослаться в первом контакте.
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
