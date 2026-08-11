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
import finalStyles from "./final-radar.module.css";
import styles from "./landing.module.css";

const PILOT_BULLETS = [
  "Ежедневный приоритет компаний",
  "Почему сейчас + факты и источники",
  "Настройка под нишу и географию",
] as const;

const LANDING_PLAN_DESCRIPTIONS = {
  pilot: "Короткий запуск, чтобы проверить Recruiter Radar на своей специализации.",
  monthly: "Для регулярного поиска новых клиентских возможностей.",
  quarterly: "Для агентств, которые используют радар как постоянный канал поиска клиентов.",
} as const;

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
          <span>Попробуйте на своей нише</span>
          <h2>Проверьте радар на своей нише за 7 дней.</h2>
          <p>
            За неделю станет понятно, находит ли радар новые релевантные компании, даёт ли понятный повод для обращения и хватает ли фактов перед первым контактом.{" "}
            {props.paymentConfigured
              ? "Разовая оплата. Без автопродления."
              : "Оставьте заявку на 7-дневный пилот без списания. Профиль сохранится — оплату можно завершить после подключения платежей."}
          </p>
        </div>

        <div className={`${styles.pilotOffer} ${panelStyles.pilotOffer}`} data-pricing-primary="true">
          <div className={styles.pilotMeta}>
            <span>Неделя</span>
            <strong>{pilotPlan.cadence}</strong>
          </div>
          <div className={styles.pilotPrice}>
            <strong>{pilotPlan.price}</strong>
          </div>
          <p>{LANDING_PLAN_DESCRIPTIONS.pilot}</p>
          <ul>
            {PILOT_BULLETS.map((bullet) => <li key={bullet}><ArrowGlyph size={14} />{bullet}</li>)}
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
          <span className={styles.secondaryOfferLabel}>Продолжите, если радар подходит вашей нише</span>
          {secondaryPlans.map((plan) => {
            const quarterly = plan.code === "quarterly";
            return (
              <article key={plan.code} data-plan-code={plan.code} data-recommended={plan.isPrimary || undefined}>
                <div className={panelStyles.offerTopline}>
                  <span>{plan.name}</span>
                  <b>{plan.cadence}</b>
                </div>
                <strong>{plan.price}</strong>
                <small className={panelStyles.planEquivalent}>
                  {quarterly ? "≈ 2 330 ₽ за 30 дней" : plan.monthlyEquivalent}
                </small>
                <p>{LANDING_PLAN_DESCRIPTIONS[plan.code]}</p>
                <div className={panelStyles.planProof}>
                  <span>{quarterly ? "Экономия 1 980 ₽" : "На 30% выгоднее недели"}</span>
                </div>
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
          <span>Коротко о главном</span>
          <h2>Что важно знать перед запуском.</h2>
          <p>Как появляются компании, откуда берутся данные и что происходит после оплаты.</p>
          <small data-faq-trust>Пример можно настроить без регистрации.</small>
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
        <span>7 ДНЕЙ / СВОЯ НИША</span>
        <h2>Посмотрите, кому стоит написать сейчас.</h2>
        <p>Настройте нишу и географию. За неделю вы увидите, помогает ли радар находить новые поводы для разговора с потенциальными клиентами.</p>
        <ul className={panelStyles.finalTrust} aria-label="Условия запуска">
          <li>990 ₽ / 7 дней</li>
          <li>Без автопродления</li>
          <li>Факты по каждой компании</li>
          <li>Сообщения отправляете вы</li>
        </ul>
        <div className={finalStyles.radar} data-final-radar-composition="signal-lock" aria-hidden="true">
          <i className={finalStyles.arc} />
          <i className={finalStyles.arc} />
          <span className={finalStyles.cluster}><i /><i /><i /></span>
          <span className={finalStyles.cluster}><i /><i /></span>
          <span className={finalStyles.cluster}><i /><i /><i /></span>
          <span className={finalStyles.activeCluster}><i /><i /><i /><i /></span>
          <span className={finalStyles.annotation}><strong>сильный повод</strong><small>3 подтверждения · сегодня</small></span>
        </div>
        <div className={styles.finalActions}>
          <Link
            href={buildCheckoutHref({ ...props.previewInput, planCode: pilotPlan.code })}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.closing}
          >
            {props.paymentConfigured ? `Запустить на 7 дней — ${pilotPlan.price}` : "Оставить заявку на пилот"} <ArrowGlyph />
          </Link>
          <a href="#preview-configurator">Сначала посмотреть пример <ArrowGlyph /></a>
        </div>
      </div>
    </section>
  );
}
