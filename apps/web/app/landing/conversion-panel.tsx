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
import { ArrowGlyph } from "./brand-glyphs";
import LandingFaqList from "./landing-faq-list";
import panelStyles from "./conversion-panel.module.css";

const PILOT_BULLETS = [
  "10 приоритетных компаний за 7 дней",
  "Повод, факты и источники по каждой",
  "Черновик первого сообщения",
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
        data-pricing-path="pilot-first"
        data-motion-reveal="section"
        data-v31-zone="pricing"
        data-variant="v1"
      >
        {/* v3.1 R8: the «Попробуйте на своей нише» overline is removed with
            its grid slot — the h2 leads the zone. */}
        <div className={panelStyles.pricingIntro} data-pricing-intro data-v31-content>
          <h2 data-v31-reveal="h2">7 дней с радаром — {pilotPlan.price}</h2>
          <p data-v31-reveal="desc">Полноценная неделя работы: 10 приоритетных компаний вашей ниши с поводом, фактами и источниками.</p>
        </div>
        <div className={panelStyles.pricingDecision} data-v31-content>
          <div
            className={panelStyles.pilotOffer}
            data-pricing-primary="true"
            data-pilot-entry="primary"
            data-v31-reveal="offer"
          >
            <div className={panelStyles.pilotTopline}>
              <div className={panelStyles.pilotMeta}>
                <span className={panelStyles.pilotEyebrow}>Пилот</span>
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
            <span className={panelStyles.secondaryOfferLabel}>После пилота — тот же радар на более долгий срок</span>
            {secondaryPlans.map((plan) => {
              const quarterly = plan.code === "quarterly";
              return (
                <article key={plan.code} data-plan-code={plan.code} data-v31-reveal="offer-row">
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
        data-v31-zone="faq"
        data-variant="v1"
        aria-labelledby="faq-title"
      >
        {/* v3.1 R8/R9: the big «Что важно знать перед запуском.» h2 is
            removed with its slot; the frozen «FAQ · Коротко о главном»
            label is preserved pixel-for-pixel and only gains heading
            semantics for assistive technology. */}
        <div className={panelStyles.faqHeading} data-faq-heading data-v31-content>
          <span id="faq-title" role="heading" aria-level={2}>FAQ · Коротко о главном</span>
        </div>
        <LandingFaqList items={props.faqItems} />
      </div>

      <div
        id="conversion-final"
        className={panelStyles.final}
        data-header-tone="dark"
        data-motion-reveal="section"
        data-v31-zone="final"
        data-variant="v2"
      >
        <div className={panelStyles.finalCopy} data-final-proof="manual-outreach" data-v31-content>
          <span className={panelStyles.finalEyebrow}>7 дней / своя ниша</span>
          <h2 data-v31-reveal="h2">Найдите, кому написать сейчас</h2>
          <p data-v31-reveal="desc">Что изменилось, чем подтверждено и с чего начать разговор — по каждой компании.</p>
        </div>
        <div className={panelStyles.finalDecision} data-v31-content data-v31-reveal="cta">
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
          <a className={panelStyles.finalSecondaryLink} href="#hero-workflow">Сначала посмотреть пример</a>
        </div>
      </div>
    </section>
  );
}
