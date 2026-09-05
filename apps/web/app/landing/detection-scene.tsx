import Link from "next/link";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../../lib/landing-analytics-contract";
import { ArrowGlyph } from "./brand-glyphs";
import HeroProductPreview from "./hero-product-preview";
import sceneStyles from "./detection-scene.module.css";

export default function DetectionScene(props: { previewHref: string; paymentConfigured: boolean }) {
  return (
    <section
      id="scene-detection"
      className={sceneStyles.section}
      aria-labelledby="detection-title"
      data-theme="inverse"
      data-header-tone="light"
      data-hero-layout="product-workspace"
      data-payment-offer={props.paymentConfigured ? "7 дней · 990 ₽" : "7 дней · заявка без списания"}
    >
      <div className={sceneStyles.copy} data-hero-copy>
        <p className={sceneStyles.serviceLabel}>Рабочий радар для рекрутинговых агентств</p>
        <h1 id="detection-title" className={sceneStyles.title} data-hero-title>
          Компании, которым стоит написать сегодня
        </h1>
        <p className={sceneStyles.description} data-hero-description>
          Радар собирает публичные сигналы найма в рабочий список: показывает, что изменилось, чем это подтверждено и с какого безопасного шага начать контакт.
        </p>
        <div className={sceneStyles.actions} data-hero-actions>
          <a
            href={props.previewHref}
            className={sceneStyles.primaryButton}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
          >
            Посмотреть пример продукта <ArrowGlyph />
          </a>
          <span className={sceneStyles.actionHint}>Демо-сценарий от 12 мая · без регистрации</span>
        </div>
        <Link href="/login?returnTo=%2Fdashboard" className={sceneStyles.loginLink}>Войти</Link>
        <p className={sceneStyles.microcopy} data-hero-trust-line>
          {props.paymentConfigured
            ? "7 дней · 990 ₽ · без автопродления · сообщения отправляете вы"
            : "7 дней · заявка без списания · сообщения отправляете вы"}
        </p>
      </div>

      <div className={sceneStyles.fieldFigure} data-hero-visual data-mobile-hero-signal>
        <HeroProductPreview />
      </div>
    </section>
  );
}
