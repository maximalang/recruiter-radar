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
import styles from "./landing.module.css";

export default function ConversionPanel(props: {
  previewInput: PublicPreviewInput;
  paymentConfigured: boolean;
  faqItems: ReadonlyArray<{ question: string; answer: string }>;
}) {
  const pilotPlan = PUBLIC_PLANS.find((plan) => plan.code === "pilot") ?? PUBLIC_PLANS[0];
  const secondaryPlans = PUBLIC_PLANS.filter((plan) => plan.code !== "pilot");

  return (
    <div className={styles.conversionPanel}>
      <div id="pricing" className={styles.pricingStage}>
        <div className={styles.pricingIntro}>
          <span>После preview / следующий шаг</span>
          <h2>Начните с недели. Продолжайте, только если радар полезен.</h2>
          <p>
            {props.paymentConfigured
              ? "Пилот — разовая оплата без продления. Месяц и квартал подключаются по заявке после проверки качества."
              : "Сейчас пилот оформляется как заявка без списания. Профиль сохранится, а к запуску можно будет вернуться после подключения оплаты."}
          </p>
        </div>

        <div className={styles.pilotOffer}>
          <div className={styles.pilotMeta}>
            <span>Рекомендуем начать</span>
            <strong>{pilotPlan.name}</strong>
          </div>
          <div className={styles.pilotPrice}>
            <strong>{pilotPlan.price}</strong>
            <span>{pilotPlan.cadence}</span>
          </div>
          <p>{pilotPlan.description}</p>
          <ul>
            {pilotPlan.bullets.slice(0, 4).map((bullet) => <li key={bullet}>{bullet}</li>)}
          </ul>
          <Link
            href={buildCheckoutHref({ ...props.previewInput, planCode: pilotPlan.code })}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.pricingPilot}
          >
            {props.paymentConfigured ? pilotPlan.ctaLabel : "Оставить заявку на неделю"} <span aria-hidden="true">↗</span>
          </Link>
          <small>{props.paymentConfigured ? "Разовая оплата · без автопродления" : "Заявка без списания · профиль сохранится"}</small>
        </div>

        <div className={styles.secondaryOffers}>
          {secondaryPlans.map((plan) => {
            const quarterly = plan.code === "quarterly";
            return (
              <article key={plan.code}>
                <span>{plan.name}</span>
                <strong>{plan.price}</strong>
                <p>{plan.description}</p>
                <Link
                  href={buildCheckoutHref({ ...props.previewInput, planCode: plan.code })}
                  data-analytics-event={LANDING_ANALYTICS_EVENT.continuationCtaClicked}
                  data-analytics-context={quarterly ? LANDING_ANALYTICS_CONTEXT.quarterly : LANDING_ANALYTICS_CONTEXT.monthly}
                >
                  {plan.ctaLabel} <span aria-hidden="true">↗</span>
                </Link>
              </article>
            );
          })}
        </div>
      </div>

      <div id="faq" className={styles.faqStage}>
        <div className={styles.faqHeading}>
          <span>FAQ / перед запуском</span>
          <h2>Коротко о данных, доставке и контроле.</h2>
        </div>
        <div className={styles.faqList}>
          {props.faqItems.map((item, index) => (
            <details key={item.question} data-analytics-event={LANDING_ANALYTICS_EVENT.faqOpened}>
              <summary><span>{String(index + 1).padStart(2, "0")}</span>{item.question}<i aria-hidden="true">＋</i></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </div>

      <div className={styles.finalCall}>
        <span>SIGNAL LOCK / 07 DAYS</span>
        <h2>Соберите радар под свою специализацию.</h2>
        <p>Получите первый короткий список компаний и решите на фактах, стоит ли продолжать.</p>
        <div>
          <Link
            href={buildCheckoutHref({ ...props.previewInput, planCode: pilotPlan.code })}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.closing}
          >
            {props.paymentConfigured ? `Активировать неделю — ${pilotPlan.price}` : "Оставить заявку на неделю"} <span aria-hidden="true">↗</span>
          </Link>
          <a href="#preview-configurator">Вернуться к preview ↑</a>
        </div>
      </div>
    </div>
  );
}
