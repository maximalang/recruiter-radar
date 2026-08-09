import Link from "next/link";

import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../../lib/landing-analytics-contract";
import {
  PUBLIC_PLANS,
  buildCheckoutHref,
  type PublicPreviewInput,
} from "../../lib/publicProduct";
import { ArrowGlyph, PlusGlyph } from "./brand-glyphs";
import panelStyles from "./conversion-panel.module.css";
import styles from "./landing.module.css";

export default function ConversionPanel(props: {
  previewInput: PublicPreviewInput;
  paymentConfigured: boolean;
  faqItems: ReadonlyArray<{ question: string; answer: string }>;
}) {
  const pilotPlan = PUBLIC_PLANS.find((plan) => plan.code === "pilot") ?? PUBLIC_PLANS[0];
  const secondaryPlans = PUBLIC_PLANS.filter((plan) => plan.code !== "pilot");

  return (
    <section className={styles.conversionPanel} aria-label="Тарифы и ответы" data-conversion-scenes="continuous" data-conversion-panel>
      <div
        id="pricing"
        className={`${styles.pricingStage} ${panelStyles.anchor} ${panelStyles.pricing} ${panelStyles.viewportSurface}`}
        data-header-tone="light"
        data-pricing-surface="true"
        data-pricing-layout="unified-grid"
      >
        <div className={styles.pricingIntro} data-pricing-intro>
          <span>07 — Тарифы</span>
          <h2>Проверьте радар на своих нишах за 7 дней.</h2>
          <p>
            {props.paymentConfigured
              ? "Неделя — короткий платный пилот без автопродления. Если выдача полезна, можно перейти на месяц или квартал."
              : "Оставьте заявку на пилот. Профиль сохранится — продолжить можно после подключения оплаты."}
          </p>
        </div>

        <div className={styles.pilotOffer} data-pricing-primary="true">
          <div className={styles.pilotMeta}>
            <span>Пилот</span>
            <strong>7 дней</strong>
          </div>
          <div className={styles.pilotPrice}>
            <strong>{pilotPlan.price}</strong>
          </div>
          <p>7 дней, чтобы проверить качество компаний, доказательств и поводов для контакта. Без автопродления.</p>
          <ul>
            {pilotPlan.bullets.slice(0, 4).map((bullet) => <li key={bullet}><ArrowGlyph size={14} />{bullet}</li>)}
          </ul>
          <Link
            href={buildCheckoutHref({ ...props.previewInput, planCode: pilotPlan.code })}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.pricingPilot}
          >
            {props.paymentConfigured ? "Запустить пилот на 7 дней" : "Оставить заявку на пилот"} <ArrowGlyph />
          </Link>
          <small data-consent-safe-copy>{props.paymentConfigured
            ? "Разовая оплата · без автопродления · далее месяц или квартал"
            : "Заявка без списания · профиль сохранится · далее месяц или квартал"}</small>
        </div>

        <div className={styles.secondaryOffers} aria-label="Продолжение после пилота" data-pricing-secondary="true">
          <span className={styles.secondaryOfferLabel}>После пилота — месяц или квартал</span>
          {secondaryPlans.map((plan) => {
            const quarterly = plan.code === "quarterly";
            return (
              <article key={plan.code} data-plan-code={plan.code}>
                <span>{quarterly ? "Квартал" : "Месяц"}</span>
                <strong>{plan.price}</strong>
                <p>{quarterly
                  ? "90 дней регулярной работы с радаром. Разовая оплата без автопродления."
                  : "30 дней для одного клиентского направления. Разовая оплата без автопродления."}</p>
                <ul>
                  {plan.bullets.slice(0, 2).map((bullet) => <li key={bullet}><ArrowGlyph size={13} />{bullet}</li>)}
                </ul>
                <Link
                  href={buildCheckoutHref({ ...props.previewInput, planCode: plan.code })}
                  data-analytics-event={LANDING_ANALYTICS_EVENT.continuationCtaClicked}
                  data-analytics-context={quarterly ? LANDING_ANALYTICS_CONTEXT.quarterly : LANDING_ANALYTICS_CONTEXT.monthly}
                >
                  {quarterly ? "Подключить квартал" : "Продолжить на месяц"} <ArrowGlyph />
                </Link>
              </article>
            );
          })}
        </div>
      </div>

      <div
        id="faq"
        className={`${styles.faqStage} ${panelStyles.anchor} ${panelStyles.faq} ${panelStyles.viewportSurface}`}
        data-header-tone="light"
        data-faq-surface="true"
        data-faq-layout="editorial"
      >
        <div className={styles.faqHeading} data-faq-heading>
          <span>08 — Перед запуском</span>
          <h2>Перед запуском — короткие ответы.</h2>
          <p>Откуда берутся сигналы, как формируется приоритет, куда приходит выдача и что остаётся под вашим контролем.</p>
          <small data-faq-trust>Интерактивный пример доступен без регистрации. Публичные данные в нём обезличены.</small>
        </div>
        <div className={styles.faqList} data-faq-list>
          {props.faqItems.map((item, index) => (
            <details key={item.question} open={index === 0} data-analytics-event={LANDING_ANALYTICS_EVENT.faqOpened} data-faq-item>
              <summary><span>{String(index + 1).padStart(2, "0")}</span>{item.question}<i aria-hidden="true"><PlusGlyph /></i></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </div>

      <div
        id="conversion-final"
        className={`${styles.finalCall} ${panelStyles.final}`}
        data-header-tone="dark"
      >
        <span>ПИЛОТ / 7 ДНЕЙ</span>
        <h2>Соберите радар под специализацию агентства.</h2>
        <p>Получите первый короткий список компаний и решите на фактах, стоит ли продолжать.</p>
        <div className={panelStyles.finalSignal} data-final-signal-composition="agency-profile" aria-hidden="true">
          <span className={panelStyles.profileNode}>Agency Profile</span>
          <i className={panelStyles.signalRoute} />
          <span className={panelStyles.signalField}>Signal field</span>
          <span className={panelStyles.constellation}><i /><i /><i /><i /><i /></span>
        </div>
        <div className={styles.finalActions}>
          <Link
            href={buildCheckoutHref({ ...props.previewInput, planCode: pilotPlan.code })}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.closing}
          >
            {props.paymentConfigured ? `Запустить пилот — ${pilotPlan.price}` : "Оставить заявку на пилот"} <ArrowGlyph />
          </Link>
          <a href="#preview-configurator">Вернуться к настройке выдачи <ArrowGlyph /></a>
        </div>
      </div>
    </section>
  );
}
