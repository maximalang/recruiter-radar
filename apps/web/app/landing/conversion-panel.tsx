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
        data-motion-reveal="section"
      >
        <div className={styles.pricingIntro} data-pricing-intro>
          <span>Тарифы</span>
          <h2>Начните с недели. Продолжайте только если радар полезен.</h2>
          <p>
            {props.paymentConfigured
              ? "990 ₽ за 7 дней без автопродления. Если выдача помогает находить компании для выхода, месяц и квартал стоят заметно дешевле в пересчёте на неделю."
              : "Оставьте заявку на 7-дневный пилот. Профиль сохранится — оплату можно завершить после подключения платежей."}
          </p>
        </div>

        <div className={`${styles.pilotOffer} ${panelStyles.pilotOffer}`} data-pricing-primary="true">
          <div className={styles.pilotMeta}>
            <span>Пилот</span>
            <strong>{pilotPlan.cadence}</strong>
          </div>
          <div className={styles.pilotPrice}>
            <strong>{pilotPlan.price}</strong>
          </div>
          <p>Проверьте на своих нишах не интерфейс, а сам результат: компании, «почему сейчас» и доказательства.</p>
          <ul>
            {pilotPlan.bullets.slice(0, 3).map((bullet) => <li key={bullet}><ArrowGlyph size={14} />{bullet}</li>)}
          </ul>
          <Link
            href={buildCheckoutHref({ ...props.previewInput, planCode: pilotPlan.code })}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.pricingPilot}
          >
            {props.paymentConfigured ? "Запустить на 7 дней" : "Оставить заявку на пилот"} <ArrowGlyph />
          </Link>
          <small data-consent-safe-copy>{props.paymentConfigured
            ? "Разовая оплата · без автопродления"
            : "Заявка без списания · профиль сохранится"}</small>
        </div>

        <div className={`${styles.secondaryOffers} ${panelStyles.secondaryOffers}`} aria-label="Продолжение после пилота" data-pricing-secondary="true">
          <span className={styles.secondaryOfferLabel}>Если радар подходит — продолжение дешевле</span>
          {secondaryPlans.map((plan) => {
            const quarterly = plan.code === "quarterly";
            return (
              <article key={plan.code} data-plan-code={plan.code} data-recommended={plan.isPrimary || undefined}>
                <div className={panelStyles.offerTopline}>
                  <span>{plan.name}</span>
                  {plan.isPrimary ? <b>Рекомендуем</b> : null}
                </div>
                <strong>{plan.price}</strong>
                <small className={panelStyles.planEquivalent}>{plan.monthlyEquivalent}</small>
                <p>{plan.description}</p>
                <div className={panelStyles.planProof}>
                  {plan.discountLabel ? <span>{plan.discountLabel}</span> : null}
                  <span>{quarterly ? "минимальная цена периода" : "30 дней регулярной работы"}</span>
                </div>
                <ul>
                  {plan.bullets.slice(0, 2).map((bullet) => <li key={bullet}><ArrowGlyph size={13} />{bullet}</li>)}
                </ul>
                <Link
                  href={buildCheckoutHref({ ...props.previewInput, planCode: plan.code })}
                  data-analytics-event={LANDING_ANALYTICS_EVENT.continuationCtaClicked}
                  data-analytics-context={quarterly ? LANDING_ANALYTICS_CONTEXT.quarterly : LANDING_ANALYTICS_CONTEXT.monthly}
                >
                  {quarterly ? "Подключить квартал" : "Подключить месяц"} <ArrowGlyph />
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
        data-motion-reveal="section"
      >
        <div className={styles.faqHeading} data-faq-heading>
          <span>Перед запуском</span>
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
        data-motion-reveal="section"
      >
        <span>ПЕРВАЯ ВЫДАЧА / 7 ДНЕЙ</span>
        <h2>Проверьте, кому стоит написать сейчас.</h2>
        <p>Соберите радар под специализацию агентства. За одну рабочую неделю станет понятно, даёт ли он новые компании и достаточно ли фактов для уверенного первого контакта.</p>
        <ul className={panelStyles.finalTrust} aria-label="Условия запуска">
          <li>990 ₽ / 7 дней</li>
          <li>Без автопродления</li>
          <li>Доказательства по каждой возможности</li>
          <li>Обращения отправляете только вы</li>
        </ul>
        <div className={panelStyles.finalSignal} data-final-signal-composition="agency-profile" aria-hidden="true">
          <span className={panelStyles.profileNode}>Профиль агентства</span>
          <i className={panelStyles.signalRoute} />
          <span className={panelStyles.signalField}>5 приоритетных компаний</span>
          <span className={panelStyles.constellation}><i /><i /><i /><i /><i /></span>
        </div>
        <div className={styles.finalActions}>
          <Link
            href={buildCheckoutHref({ ...props.previewInput, planCode: pilotPlan.code })}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.closing}
          >
            {props.paymentConfigured ? `Запустить радар — ${pilotPlan.price}` : "Оставить заявку на пилот"} <ArrowGlyph />
          </Link>
          <a href="#preview-configurator">Сначала настроить пример <ArrowGlyph /></a>
        </div>
      </div>
    </section>
  );
}
