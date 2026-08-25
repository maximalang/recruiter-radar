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

const PILOT_BULLETS = [
  "Ежедневный приоритет компаний",
  "Почему сейчас + факты и источники",
  "Профиль по нише и географии",
] as const;

export default function ConversionPanel(props: {
  previewInput: PublicPreviewInput;
  paymentConfigured: boolean;
  faqItems: ReadonlyArray<{ question: string; answer: string }>;
}) {
  const pilotPlan = PUBLIC_PLANS.find((plan) => plan.code === "pilot") ?? PUBLIC_PLANS[0];
  const secondaryPlans = PUBLIC_PLANS.filter((plan) => plan.code !== "pilot");

  return (
    <section className={panelStyles.panel} aria-label="Тарифы и ответы" data-conversion-scenes="continuous" data-conversion-panel>
      <div
        id="pricing"
        className={`${panelStyles.anchor} ${panelStyles.pricing}`}
        data-header-tone="light"
        data-pricing-surface="true"
        data-pricing-layout="pilot-decision"
        data-motion-reveal="section"
      >
        <div className={panelStyles.pricingIntro} data-pricing-intro>
          <span>Попробуйте на своей нише</span>
          <h2>Попробовать 7 дней — {pilotPlan.price}</h2>
          <p>Полноценная неделя работы с радаром: приоритетные компании вашей ниши с поводом, фактами и источниками. Оплата разовая, без автопродления.</p>
        </div>

        <div className={panelStyles.pricingDecision}>
          <div
            className={panelStyles.pilotOffer}
            data-pricing-primary="true"
            data-pilot-entry="primary"
          >
            <div className={panelStyles.pilotTopline}>
              <div className={panelStyles.pilotMeta}>
                <span className={panelStyles.pilotEyebrow}>Пилот · 7 дней</span>
                <strong>{pilotPlan.cadence}</strong>
              </div>
              <div className={panelStyles.pilotPrice}>{pilotPlan.price}</div>
            </div>
            <ul>
              {PILOT_BULLETS.map((bullet) => <li key={bullet}><ArrowGlyph size={14} />{bullet}</li>)}
            </ul>
            <Link
              className={panelStyles.pilotCta}
              prefetch={false}
              href={buildCheckoutHref({ ...props.previewInput, planCode: pilotPlan.code })}
              data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
              data-analytics-context={LANDING_ANALYTICS_CONTEXT.pricingPilot}
            >
              {props.paymentConfigured ? "Запустить на 7 дней" : "Оставить заявку на пилот"} <ArrowGlyph />
            </Link>
            <small data-consent-safe-copy>{props.paymentConfigured
              ? "Разовая оплата · доступ открывается сразу · без автопродления"
              : "Оставьте заявку на 7-дневный пилот без списания · профиль сохранится"}</small>
          </div>

          <div className={panelStyles.secondaryOffers} aria-label="Продолжение после пилота" data-pricing-secondary="true">
            <span className={panelStyles.secondaryOfferLabel}>После пилота — тот же радар, на более длинный срок</span>
            {secondaryPlans.map((plan) => {
              const quarterly = plan.code === "quarterly";
              return (
                <article key={plan.code} data-plan-code={plan.code}>
                  <div>
                    <span>{plan.name}</span>
                    <small>{plan.cadence}</small>
                  </div>
                  <strong>{plan.price}</strong>
                  <Link
                    prefetch={false}
                    href={buildCheckoutHref({ ...props.previewInput, planCode: plan.code })}
                    data-analytics-event={LANDING_ANALYTICS_EVENT.continuationCtaClicked}
                    data-analytics-context={quarterly ? LANDING_ANALYTICS_CONTEXT.quarterly : LANDING_ANALYTICS_CONTEXT.monthly}
                  >
                    {quarterly ? "Квартал" : "Месяц"} <ArrowGlyph />
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <div
        id="faq"
        className={`${panelStyles.anchor} ${panelStyles.faq}`}
        data-header-tone="light"
        data-faq-surface="true"
        data-faq-layout="centered"
        data-motion-reveal="section"
      >
        <div className={panelStyles.faqHeading} data-faq-heading>
          <span>FAQ · Коротко о главном</span>
          <h2>Что важно знать перед запуском.</h2>
          <p>Как появляются компании, откуда берутся данные и что происходит после оплаты.</p>
          <small data-faq-trust>Пример можно настроить без регистрации.</small>
        </div>
        <div className={panelStyles.faqList} data-faq-list>
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
        className={panelStyles.final}
        data-header-tone="dark"
        data-motion-reveal="section"
      >
        <div className={panelStyles.finalCopy}>
          <svg className={panelStyles.finalField} viewBox="0 0 520 320" aria-hidden="true" focusable="false" data-final-radar="echo">
            <defs>
              <radialGradient id="final-echo-halo" cx="50%" cy="50%" r="50%">
                <stop className={panelStyles.finalHaloCore} offset="0" />
                <stop offset="1" stopColor="var(--color-signal)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <path className={panelStyles.finalArc} d="M 60 318 A 258 258 0 0 1 518 296" />
            <circle className={panelStyles.finalOrbit} cx="330" cy="196" r="118" pathLength={100} strokeDasharray="14 86" />
            <circle className={panelStyles.finalSignal} cx="330" cy="196" r="3.4" />
            <circle cx="352" cy="176" r="1.7" /><circle cx="309" cy="212" r="1.5" />
            <circle className={panelStyles.finalEchoCopper} cx="368" cy="214" r="2.1" />
          </svg>
          <span className={panelStyles.finalEyebrow}>7 дней / своя ниша</span>
          <h2>Посмотрите, кому стоит написать сейчас.</h2>
          <p>Радар покажет приоритет компаний, проверяемые факты и конкретный повод для первого контакта.</p>
        </div>
        <div className={panelStyles.finalDecision}>
          <ul className={panelStyles.finalTrust} aria-label="Условия запуска">
            <li>{pilotPlan.price} / 7 дней</li>
            <li>Без автопродления</li>
            <li>Факты и источники по каждой компании</li>
            <li>Сообщения отправляете вы</li>
          </ul>
          <Link
            className={panelStyles.finalCta}
            prefetch={false}
            href={buildCheckoutHref({ ...props.previewInput, planCode: pilotPlan.code })}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.closing}
          >
            {props.paymentConfigured ? `Запустить на 7 дней — ${pilotPlan.price}` : "Оставить заявку на пилот"} <ArrowGlyph />
          </Link>
          <a className={panelStyles.finalSecondaryLink} href="#preview-configurator">Сначала посмотреть пример</a>
        </div>
      </div>
    </section>
  );
}
