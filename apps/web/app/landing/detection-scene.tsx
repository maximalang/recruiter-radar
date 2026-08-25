import Link from "next/link";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../../lib/landing-analytics-contract";
import { ArrowGlyph } from "./brand-glyphs";
import HeroSignalField from "./hero-signal-field";
import sceneStyles from "./detection-scene.module.css";

export default function DetectionScene(props: { previewHref: string; paymentConfigured: boolean }) {
  return (
    <section
      id="scene-detection"
      className={sceneStyles.section}
      aria-labelledby="detection-title"
      data-theme="inverse"
      data-header-tone="dark"
      data-hero-layout="ambient-radar"
      data-payment-offer={props.paymentConfigured ? "7 дней · 990 ₽" : "7 дней · заявка без списания"}
    >
      <div className={sceneStyles.fieldFigure} data-hero-visual data-mobile-hero-signal>
        <HeroSignalField />
      </div>

      <div className={sceneStyles.kicker}>
        <span className={sceneStyles.kickerRule} aria-hidden="true" />
        <span>Радар новых клиентов для агентств</span>
        <span className={sceneStyles.kickerMeta}>Сигнал → факт → повод</span>
      </div>

      <div className={sceneStyles.copy} data-hero-copy>
        <p className={sceneStyles.serviceLabel}>Открытые источники найма · ежедневная проверка</p>
        <h1 id="detection-title" className={sceneStyles.title} data-hero-title>
          Компании, которым стоит написать сегодня.
        </h1>
        <p className={sceneStyles.description} data-hero-description>
          Recruiter Radar отслеживает публичный найм и находит компании, где потребность в подборе растёт. Вы получаете приоритетный список: почему компания актуальна сейчас, какие факты это подтверждают и с чего начать контакт.
        </p>
        <p className={sceneStyles.visuallyHidden}>
          Схема показывает несколько подтверждающих сигналов найма, объединённых в одну клиентскую возможность.
        </p>
        <div className={sceneStyles.actions} data-hero-actions>
          <a
            href={props.previewHref}
            className={sceneStyles.primaryButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
          >
            Посмотреть пример <ArrowGlyph />
          </a>
          <span className={sceneStyles.actionHint}>Настройте нишу и географию · без регистрации</span>
        </div>
        <Link href="/login?returnTo=%2Fdashboard" className={sceneStyles.loginLink}>Войти</Link>
        <p className={sceneStyles.microcopy} data-hero-trust-line>
          {props.paymentConfigured
            ? "7 дней · 990 ₽ · без автопродления · сообщения отправляете вы"
            : "7 дней · заявка без списания · сообщения отправляете вы"}
        </p>
      </div>
    </section>
  );
}
