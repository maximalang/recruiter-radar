import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { getPaymentProviderSetupState } from "../lib/payments";
import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../lib/landing-analytics-contract";
import {
  PUBLIC_PLANS,
  PUBLIC_PREVIEW_FIELD_LIMITS,
  buildCheckoutHref,
  buildPublicPreviewHref,
  getPublicSampleDigestState,
  hasPublicPreviewInput,
  readPublicPreviewInput,
  type PublicPreviewInput,
} from "../lib/publicProduct";
import { formatScorePoints, scorePercent, scoreTone } from "../lib/scoring/score-display";
import { formatLawfulContactPath, deriveWhyNow } from "../lib/leads-data";
import { formatVacanciesCount } from "../lib/format/plural";
import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  StatusBadge,
  SurfaceCard,
} from "./ui/page-primitives";
import ppStyles from "./ui/page-primitives.module.css";
import {
  buildPreviewEvidenceItems,
  buildFaqItems,
  cleanEmployerName,
  formatLocationCaption,
  formatVacancyFreshness,
  pickEvidenceTitles,
} from "./home-page-components";
import hpStyles from "./home-page-components.module.css";
import FiurPopover from "./fiur-popover";
import LandingAnalytics from "./landing-analytics";
import LandingDetailsInteractions from "./landing-details-interactions";
import LandingDeliveryDemo from "./landing-delivery-demo";
import LandingHeader from "./landing-header";
import LandingHeroInteractions from "./landing-hero-interactions";
import LandingMethodology from "./landing-methodology";
import LandingPreviewInteractions from "./landing-preview-interactions";
import LandingPreviewPresets from "./landing-preview-presets";
import PreviewGeneratedEvent from "./preview-generated-event";
import RadarCanvas from "./radar-canvas";
import ScrollReveal from "./scroll-reveal";
import ScrollProgress from "./scroll-progress";
import { SiteFooter } from "./ui/site-footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recruiter Radar — ежедневный радар по нанимающим компаниям",
  description:
    "Каждый день Recruiter Radar находит лучшие компании под специализацию агентства: что меняется, почему сейчас и как выйти на них корректно. Telegram — основной канал доставки, доступны и дополнительные каналы. Для рекрутинговых агентств и BD-команд.",
};

const VISIBLE_PREVIEW_ITEMS = 2;
const PREVIEW_PRESETS = [
  { label: "Инженерный подбор · Москва", specialization: "инженерный подбор", targetCity: "Москва" },
  { label: "IT-подбор · удалённо", specialization: "IT-подбор", targetCity: "удалённо" },
  { label: "Коммерческие роли · Петербург", specialization: "коммерческие роли", targetCity: "Санкт-Петербург" },
] as const;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type HomePreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  // Pure search-param parse only — no DB. This keeps `previewInput` available
  // for the pricing cards + closing CTA (which read it synchronously) while the
  // actual digest DB query lives behind a <Suspense> boundary in <PreviewSection>
  // below. The home page is `force-dynamic`, so without the boundary the whole
  // server render blocked on getPublicSampleDigestState (a Postgres query) and
  // first-contentful-paint sat at ~2.5s — the "half the landing doesn't load"
  // symptom. Now hero + problem + how-it-works + quality + pricing + FAQ
  // paint immediately and the live preview streams in.
  const previewInput = readPublicPreviewInput(resolvedSearchParams);
  const hasPreview = hasPublicPreviewInput(previewInput);
  const checkoutHref = buildCheckoutHref(previewInput);
  const paymentSetup = getPaymentProviderSetupState();
  const faqItems = buildFaqItems(paymentSetup.configured);
  const pilotPlan = PUBLIC_PLANS.find((p) => p.code === "pilot") ?? PUBLIC_PLANS[0];
  const secondaryPlans = PUBLIC_PLANS.filter((p) => p.code !== "pilot");

  return (
    <PageFrame maxWidth="1160px" dataDeployAnchor="recruiter-radar-landing-v3">
      <LandingAnalytics />
      <LandingDetailsInteractions />
      <ScrollProgress />
      <div className={hpStyles.ambientBg} aria-hidden="true">
        <span className={hpStyles.ambientGrid} />
      </div>
      <a href="#main-content" className={ppStyles.skipLink}>Перейти к содержанию</a>

      {/* Hero */}
      <section
        id="main-content"
        className={hpStyles.heroSection}
        aria-label="Recruiter Radar"
        data-landing-hero
      >
        <RadarCanvas />
        <LandingHeroInteractions />
        <div className={hpStyles.heroContent}>
          <div className={hpStyles.heroCopy}>
            <div className={hpStyles.heroEyebrow} data-hero-step>
              <span aria-hidden="true" />
              Клиентский радар для рекрутинговых агентств
            </div>
            <h1 className={hpStyles.heroTitle} data-hero-step>
              Компании, которым стоит написать сегодня. <span className={hpStyles.heroTitleAccent}>С доказательствами.</span>
            </h1>
            <p className={hpStyles.heroSubtitle} data-hero-step>
              Каждый день Recruiter Radar находит лучшие компании под специализацию агентства и показывает сигнал найма, уровень уверенности и безопасный путь контакта.
            </p>
            <div className={hpStyles.heroActions} data-hero-step>
              <a
                href="#preview-configurator"
                className={hpStyles.heroCta}
                data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
                data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
              >
                Настроить мой радар
                <svg className={hpStyles.heroCtaArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="13 6 19 12 13 18" />
                </svg>
              </a>
              <a
                href="#preview-results"
                className={hpStyles.heroSecondaryCta}
                data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
                data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroResults}
              >
                Посмотреть результат
              </a>
            </div>
            <p className={hpStyles.heroFootnote}>
              {pilotPlan.price} за {pilotPlan.cadence} · без автопродления · Telegram — основной канал
            </p>
          </div>

          <div
            className={hpStyles.heroProduct}
            aria-label="Как Recruiter Radar оценивает компанию"
            data-hero-step
            data-hero-tilt
          >
            <div className={hpStyles.heroProductTopbar}>
              <span className={hpStyles.heroProductLabel}>Так выглядит лид в радаре</span>
              <span className={hpStyles.heroProductLive}>уровень доверия A</span>
            </div>
            <div className={hpStyles.heroCompanyRow}>
              <div>
                <div className={hpStyles.heroCompanyName}>Производственная компания</div>
                <div className={hpStyles.heroCompanyMeta}>Москва и область · промышленность</div>
              </div>
              <div className={hpStyles.heroScore}><strong>87</strong><span>/100</span></div>
            </div>
            <div className={hpStyles.heroScoreTrack}><span /></div>
            <div className={hpStyles.heroEvidenceRow}>
              <div><span>Что изменилось</span><p>14 новых вакансий за 6 дней</p></div>
              <div><span>Момент</span><p>Появилась редкая инженерная роль</p></div>
              <div><span>Как связаться</span><p>Сайт компании и HR-форма</p></div>
            </div>
            <div className={hpStyles.heroSignalMeters}>
              <div className={hpStyles.heroSignalMeter}>
                <div className={hpStyles.heroSignalMeterHead}>
                  <span>Соответствие профилю</span>
                  <strong>Высокое</strong>
                </div>
                <div className={hpStyles.heroSignalMeterTrack} data-tone="green"><span style={{ width: "88%" }} /></div>
              </div>
              <div className={hpStyles.heroSignalMeter}>
                <div className={hpStyles.heroSignalMeterHead}>
                  <span>Сила сигнала</span>
                  <strong>Сильная</strong>
                </div>
                <div className={hpStyles.heroSignalMeterTrack}><span style={{ width: "84%" }} /></div>
              </div>
              <div className={hpStyles.heroSignalMeter}>
                <div className={hpStyles.heroSignalMeterHead}>
                  <span>Актуальность</span>
                  <strong>Сегодня</strong>
                </div>
                <div className={hpStyles.heroSignalMeterTrack} data-tone="amber"><span style={{ width: "94%" }} /></div>
              </div>
            </div>
          </div>

        </div>
      </section>

      <LandingHeader activationHref={checkoutHref} />

      {/* Problem — why this radar exists */}
      <ScrollReveal as="section" className={`${hpStyles.scrollSection} ${hpStyles.problemSection}`}>
        <div className={hpStyles.problemLayout}>
          <SectionIntro
            accent
            eyebrow="Проблема"
            title="Вакансий много. Приоритета нет."
            description="Радар сокращает исследование до короткого списка компаний, где найм подтверждён, момент объясним, а следующий шаг понятен."
          />
          <ol className={hpStyles.problemList}>
            <li className={hpStyles.problemRow}>
              <span className={hpStyles.problemIndex}>01</span>
              <div><h3>Все видят одни вакансии</h3><p>Обычная реакция на публикацию не даёт преимущества: её одновременно замечают десятки агентств.</p></div>
            </li>
            <li className={hpStyles.problemRow}>
              <span className={hpStyles.problemIndex}>02</span>
              <div><h3>Вакансия ещё не означает спрос</h3><p>Нужны динамика найма, профиль компании и несколько независимых фактов — не один заголовок.</p></div>
            </li>
            <li className={hpStyles.problemRow}>
              <span className={hpStyles.problemIndex}>03</span>
              <div><h3>Контекст собирается слишком долго</h3><p>Источники, даты и корпоративный контакт приходится проверять вручную, когда момент уже уходит.</p></div>
            </li>
          </ol>
        </div>
      </ScrollReveal>

      {/* The section shell and heading remain mounted while only the DB-backed
          workspace streams. This keeps sticky navigation and CTA anchors stable
          across the Suspense replacement. */}
      <section id="preview" data-section="preview" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Рабочий радар"
          title="Проверьте радар на своём профиле"
          description="Укажите специализацию и географию. Радар пересчитает приоритеты и покажет, почему каждая компания поднялась в выдаче."
        />
        <Suspense fallback={<PreviewSkeleton />}>
          <PreviewSection previewInput={previewInput} hasPreview={hasPreview} checkoutHref={checkoutHref} />
        </Suspense>
        <LandingPreviewInteractions />
      </section>

      {/* How it works — the three-step flow */}
      <ScrollReveal as="section" id="how-it-works" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Как работает"
          title="Готовый список — каждое утро"
          description="Настраиваете профиль один раз. Дальше радар сам собирает и проверяет сигналы найма."
        />
        <div className={hpStyles.steps}>
          <article className={`${hpStyles.step} ${hpStyles.revealCard}`}>
            <span className={hpStyles.stepIndex}>01 · Профиль</span>
            <h3>Задаёте нишу</h3>
            <p>Специализация, роли, отрасли, география и исключения — под ваше агентство.</p>
          </article>
          <article className={`${hpStyles.step} ${hpStyles.revealCard}`}>
            <span className={hpStyles.stepIndex}>02 · Проверка</span>
            <h3>Радар ищет сигналы</h3>
            <p>Карьерные страницы, вакансии и динамика найма — с подтверждением и оценкой уверенности.</p>
          </article>
          <article className={`${hpStyles.step} ${hpStyles.revealCard}`}>
            <span className={hpStyles.stepIndex}>03 · Результат</span>
            <h3>Получаете приоритеты</h3>
            <p>3–7 компаний с причиной, доказательствами, контактом и следующим шагом — в подключённых каналах.</p>
          </article>
        </div>
        <aside className={hpStyles.sourceArchitecture} aria-labelledby="source-architecture-title">
          <div className={hpStyles.sourceArchitectureHeader}>
            <div>
              <span className={hpStyles.sourceArchitectureEyebrow}>Контур данных</span>
              <h3 id="source-architecture-title">Каждый источник отвечает за свою часть доказательства</h3>
            </div>
            <p>Лид появляется не из списка площадок. Сначала радар находит сигнал найма, затем подтверждает компанию и только после добавляет контекст.</p>
          </div>

          <ol className={hpStyles.sourceLayers}>
            <li className={hpStyles.sourceLayer} data-source-role="origin">
              <div className={hpStyles.sourceLayerMeta}>
                <span>01 · Создаёт сигнал</span>
                <em>допущены</em>
              </div>
              <h4>Источники клиентской выдачи</h4>
              <p><strong>hh.ru, Работа России и прямые карьерные страницы.</strong> Только они могут стать основанием для лида — после проверки уверенности.</p>
            </li>
            <li className={hpStyles.sourceLayer} data-source-role="verification">
              <div className={hpStyles.sourceLayerMeta}>
                <span>02 · Подтверждает</span>
                <em>не создаёт лид</em>
              </div>
              <h4>Компания и путь контакта</h4>
              <p><strong>Сайт компании и ЕГРЮЛ/ФНС</strong> уточняют юрлицо, домен и безопасный корпоративный канал. Отдельно лид не создают.</p>
            </li>
            <li className={hpStyles.sourceLayer} data-source-role="context">
              <div className={hpStyles.sourceLayerMeta}>
                <span>03 · Усиливает</span>
                <em>только контекст</em>
              </div>
              <h4>Почему сейчас</h4>
              <p><strong>Корпоративные события, официальные публикации и отраслевой контекст</strong> объясняют момент обращения, но не заменяют доказательство найма.</p>
            </li>
          </ol>

          <details className={hpStyles.sourceGateDisclosure} data-animated-details>
            <summary>
              <span>Что пока не попадает в клиентскую выдачу</span>
              <em>5 групп источников</em>
            </summary>
            <p>SuperJob, Хабр Карьера, страницы компаний LinkedIn, технологические и региональные доски вакансий остаются за контуром выдачи, пока не пройдут проверки уверенности, качества данных и правомерности доступа.</p>
          </details>
        </aside>
      </ScrollReveal>

      {/* Evidence contract + enabled delivery channels */}
      <ScrollReveal as="section" id="quality" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Проверка сигнала"
          title="Почему компании стоит написать"
          description="Рекомендация появляется только вместе с проверяемыми фактами, уровнем уверенности и безопасным корпоративным контактом."
        />
        <div className={hpStyles.qualityGrid}>
          <LandingMethodology />

          <LandingDeliveryDemo />
        </div>
      </ScrollReveal>

      {/* Pricing — hierarchy: primary week plan, then secondary plans */}
      <ScrollReveal as="section" id="pricing" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Тарифы"
          title="Начните с недели. Продолжайте, только если радар полезен."
          description="Пилот — разовая оплата без продления. Месяц и квартал подключаются по заявке после проверки качества."
        />

        <div className={hpStyles.pricingGrid}>
          <SurfaceCard
            key={pilotPlan.code}
            className={`${hpStyles.primaryPlanCard} ${hpStyles.revealCard}`}
            padding="var(--plan-card-padding)"
          >
            <div className={hpStyles.primaryPlanCardHead}>
              <div className={ppStyles.planPriceContainer}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <StatusBadge tone="info" className={ppStyles.planBadge}>
                    {pilotPlan.name}
                  </StatusBadge>
                </div>
                <div className={hpStyles.planPriceRow}>
                  <span className={ppStyles.planPrice}>{pilotPlan.price}</span>
                </div>
                <div className={ppStyles.planPriceCadence}>{pilotPlan.cadence}</div>
              </div>
              <span className={hpStyles.primaryPlanBadge}>Рекомендуем начать</span>
            </div>
            <p className={hpStyles.planDescription}>{pilotPlan.description}</p>
            <div className={hpStyles.planFeatureLine}>
              <b>Разовая оплата</b>
              <span>Без автопродления</span>
            </div>
            <p className={hpStyles.billingNote}>После оплаты вы настраиваете профиль и подключаете Telegram.</p>
            <Link
              href={buildCheckoutHref({ ...previewInput, planCode: pilotPlan.code })}
              className={`${ppStyles.primaryAction} ${hpStyles.planCta}`}
              data-analytics-event={LANDING_ANALYTICS_EVENT.pilotCtaClicked}
              data-analytics-context={LANDING_ANALYTICS_CONTEXT.pricing}
            >
              {pilotPlan.ctaLabel}
            </Link>
          </SurfaceCard>

          <div className={hpStyles.secondaryPlansRow}>
            {secondaryPlans.map((plan) => {
              const isQuarterly = plan.code === "quarterly";
              return (
                <SurfaceCard
                  key={plan.code}
                  className={`${hpStyles.secondaryPlanCard} ${hpStyles.revealCard}`}
                  padding="var(--plan-card-padding)"
                >
                  <div className={ppStyles.planPriceContainer}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <StatusBadge tone="neutral" className={ppStyles.planBadge}>
                        {plan.name}
                      </StatusBadge>
                      {isQuarterly ? (
                        <span className={hpStyles.savingsBadge}>экономия 14 980 ₽</span>
                      ) : null}
                    </div>
                    <div className={hpStyles.planPriceRow}>
                      <span className={ppStyles.planPrice}>{plan.price}</span>
                      {isQuarterly ? (
                        <span className={hpStyles.planPriceSmall}>~9 997 ₽/мес</span>
                      ) : null}
                    </div>
                    <div className={ppStyles.planPriceCadence}>{plan.cadence}</div>
                  </div>
                  <p className={hpStyles.planDescription}>{plan.description}</p>
                  <div className={hpStyles.planFeatureLine}>
                    <b>Подключение по заявке</b>
                    <span>Без автоматического списания</span>
                  </div>
                  <Link
                    href={buildCheckoutHref({ ...previewInput, planCode: plan.code })}
                    className={`${ppStyles.secondaryAction} ${hpStyles.planCta}`}
                    data-analytics-event={LANDING_ANALYTICS_EVENT.continuationRequested}
                    data-analytics-context={LANDING_ANALYTICS_CONTEXT.pricing}
                  >
                    {plan.ctaLabel}
                  </Link>
                </SurfaceCard>
              );
            })}
          </div>
        </div>

        <div className={hpStyles.includedOnce}>
          <div className={hpStyles.includedOnceLabel}>В любой тариф входит</div>
          <ul className={hpStyles.includedOnceList}>
            {PUBLIC_PLANS[0].bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <div className={ppStyles.helperText} style={{ marginTop: "4px" }}>
            Оплата через ЮKassa, чек по ФЗ-54.{" "}
            <Link href="/terms" style={{ color: "var(--c-brand)", textDecoration: "underline" }}>Оферта</Link>.
          </div>
        </div>
      </ScrollReveal>

      {/* FAQ */}
      <ScrollReveal as="section" id="faq" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="FAQ"
          title="Главные вопросы перед запуском"
          description="Что именно приходит, откуда берутся данные и что остаётся под вашим контролем."
        />
        {faqItems.map((item) => (
          <details
            key={item.question}
            className={`${hpStyles.faqCard} ${hpStyles.revealCard}`}
            data-analytics-event={LANDING_ANALYTICS_EVENT.faqOpened}
            data-animated-details
          >
            <summary className={hpStyles.faqSummary}>
              <span>{item.question}</span>
              <svg className={hpStyles.faqChevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </summary>
            <div className={hpStyles.faqAnswer}>{item.answer}</div>
          </details>
        ))}
      </ScrollReveal>

      {/* Closing CTA band */}
      <section className={hpStyles.closingBand}>
        <h2 className={hpStyles.closingTitle}>Проверьте новый канал за 7 дней</h2>
        <p className={hpStyles.closingText}>
          Настройте профиль, получите первый радар и решите на фактах, стоит ли продолжать.
        </p>
        <div className={hpStyles.closingActions}>
          <Link
            href={checkoutHref}
            className={hpStyles.heroCta}
            data-analytics-event={LANDING_ANALYTICS_EVENT.closingCtaClicked}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.closing}
          >
            Активировать неделю — 2 990 ₽
          </Link>
          <a href="#preview" className={hpStyles.heroSecondaryCta}>Посмотреть пример</a>
        </div>
      </section>

      <SiteFooter />
    </PageFrame>
  );
}

/**
 * Live preview section — the only DB-backed part of the home page. Wrapped in
 * <Suspense> by HomePage so hero + every other section paint immediately while
 * getPublicSampleDigestState (a Postgres query) resolves. Owns the profile form
 * and digest cards in one workspace so the description copy can read
 * `isLive` and the form defaults read `previewInput` — both pure of the DB
 * except this one awaited call. `previewInput`/`hasPreview`/`checkoutHref` are
 * pre-computed synchronously in HomePage and passed in (the pricing cards and
 * closing CTA also read `previewInput`, so we don't recompute it here).
 */
export async function PreviewSection(props: {
  previewInput: PublicPreviewInput;
  hasPreview: boolean;
  checkoutHref: string;
}) {
  const { previewInput, hasPreview, checkoutHref } = props;
  const previewState = await getPublicSampleDigestState(previewInput);
  const visiblePreviewItems = previewState.items.slice(0, VISIBLE_PREVIEW_ITEMS);
  const hiddenPreviewItems = previewState.items.slice(VISIBLE_PREVIEW_ITEMS);
  const appliedProfile = [previewInput.specialization, previewInput.targetCity].filter(Boolean);

  return (
    <div className={hpStyles.previewSectionContent} data-preview-section-content>
      <PreviewGeneratedEvent
        generated={previewState.isLive && previewState.isPersonalized}
        context={LANDING_ANALYTICS_CONTEXT.preview}
      />
      <div className={hpStyles.previewWorkspace}>
        <div id="preview-configurator" className={hpStyles.previewSurfaceAnchor}>
          <SurfaceCard
            className={hpStyles.previewConfigurator}
            padding="var(--preview-surface-padding)"
          >
          <div className={hpStyles.previewConfiguratorLead}>
            <h3 className={hpStyles.previewCardHeading}>Соберите свою выдачу</h3>
            <p>Двух полей достаточно для первого пересчёта. Можно начать с готового профиля.</p>
            <LandingPreviewPresets
              options={PREVIEW_PRESETS.map((preset) => ({
                label: preset.label,
                href: buildPublicPreviewHref({
                  ...preset,
                  dailyDigestLimit: previewInput.dailyDigestLimit,
                }),
                selected:
                  previewInput.specialization === preset.specialization &&
                  previewInput.targetCity === preset.targetCity,
              }))}
            />
          </div>

          <form
            method="GET"
            action="/#preview-results"
            className={hpStyles.previewForm}
            data-preview-form
            aria-busy="false"
          >
            <label htmlFor="specialization" className={ppStyles.field}>
              <span className={ppStyles.fieldLabel}>Специализация</span>
              <input
                id="specialization"
                name="specialization"
                defaultValue={previewInput.specialization}
                maxLength={PUBLIC_PREVIEW_FIELD_LIMITS.specialization}
                placeholder="Промышленный подбор / финансы C-level"
                className={ppStyles.input}
              />
            </label>

            {previewInput.includeKeywords ? (
              <input type="hidden" name="includeKeywords" value={previewInput.includeKeywords} />
            ) : null}
            {previewInput.excludeKeywords ? (
              <input type="hidden" name="excludeKeywords" value={previewInput.excludeKeywords} />
            ) : null}
            <input type="hidden" name="dailyDigestLimit" value={previewInput.dailyDigestLimit} />

            <label htmlFor="targetCity" className={ppStyles.field}>
              <span className={ppStyles.fieldLabel}>География</span>
              <input
                id="targetCity"
                name="targetCity"
                defaultValue={previewInput.targetCity}
                maxLength={PUBLIC_PREVIEW_FIELD_LIMITS.targetCity}
                placeholder="Москва / удалённо"
                className={ppStyles.input}
              />
            </label>

            <div className={hpStyles.previewFormActions}>
              <button type="submit" className={ppStyles.primaryAction} data-preview-submit>
                <span data-preview-submit-label>Посмотреть компании</span>
                <span data-preview-submit-status hidden>Радар анализирует сигналы…</span>
              </button>

              {hasPreview ? (
                <Link href="/#preview" className={ppStyles.secondaryAction}>
                  Сбросить
                </Link>
              ) : null}
            </div>
          </form>
          </SurfaceCard>
        </div>

        <div
          id="preview-results"
          className={hpStyles.previewSurfaceAnchor}
          data-preview-results
        >
          <SurfaceCard
            className={`${hpStyles.previewCardContainer} ${hpStyles.previewResults}`}
            padding="var(--preview-surface-padding)"
          >
          <div className={hpStyles.previewHeaderRow}>
            <div>
              <h3 className={hpStyles.previewCardHeading}>
                {previewState.isPersonalized ? "Радар для вашего профиля" : "Утренняя выдача"}
              </h3>
              <span className={hpStyles.previewResultCount}>{formatCompaniesCount(previewState.items.length)} в текущей выдаче</span>
            </div>
            <StatusBadge tone={previewState.isPersonalized ? "info" : "neutral"} style={{ justifySelf: "start" }}>
              {previewState.isLive ? "актуальные данные" : "примерные данные"}
            </StatusBadge>
          </div>

          {!previewState.isLive ? (
            <div className={hpStyles.previewDemoNote}>
              <strong>Обезличенный набор</strong>
              <span>{previewState.isPersonalized
                ? "Приоритеты и оценка соответствия реально пересчитаны по введённому профилю; названия компаний и факты — примерные данные."
                : "Выберите профиль или заполните поля: порядок компаний и оценка соответствия изменятся по тем же правилам, что в live-выдаче."}</span>
            </div>
          ) : null}

          {appliedProfile.length > 0 ? (
            <div className={hpStyles.previewAppliedProfile} aria-label="Применённый профиль">
              <span>Профиль</span>
              {appliedProfile.map((value) => <strong key={value}>{value}</strong>)}
            </div>
          ) : null}

          {previewState.items.length === 0 ? (
            <NoticeBox
              tone="neutral"
              title="Пока нет совпадений"
              description="Расширьте географию или смягчите специализацию — и список обновится."
            />
          ) : (
            <div className={hpStyles.previewResultsBody}>
              {previewState.isPersonalized && !previewState.hasExactMatches ? (
                <NoticeBox
                  tone="neutral"
                  title="Точных совпадений по нише пока нет"
                  description="Показываем ближайшие по релевантности. Уточните профиль или расширьте специализацию."
                />
              ) : null}
              <div className={hpStyles.previewItemsGrid}>
                {visiblePreviewItems.map((item, index) => (
                  <PreviewDigestCard
                    key={`${item.org_id}-${item.rank}`}
                    item={item}
                    defaultOpen={index === 0}
                  />
                ))}
              </div>

              {hiddenPreviewItems.length > 0 ? (
                <details className={ppStyles.disclosure} data-animated-details>
                  <summary className={ppStyles.disclosureSummary}>
                    Показать ещё {hiddenPreviewItems.length} компаний
                  </summary>
                  <div className={ppStyles.disclosureBody}>
                    <div className={hpStyles.previewItemsGrid}>
                      {hiddenPreviewItems.map((item) => (
                        <PreviewDigestCard
                          key={`${item.org_id}-${item.rank}`}
                          item={item}
                          defaultOpen={false}
                        />
                      ))}
                    </div>
                  </div>
                </details>
              ) : null}
            </div>
          )}

          <Link
            href={checkoutHref}
            className={ppStyles.primaryAction}
            data-analytics-event={LANDING_ANALYTICS_EVENT.previewCheckoutClicked}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.preview}
          >
            {previewState.items.length > 0
              ? "Получать такой радар каждое утро"
              : "Попробовать неделю"}
          </Link>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}

/**
 * Suspense fallback for <PreviewSection>. Reserves the same workspace footprint
 * and shows the eyebrow/title so the block is visibly
 * "there" (not missing) while the digest query streams in — the section heading
 * is what the user's "half the landing doesn't load" complaint was about. The
 * shimmer bars stay subtle (premium, not a spinner) and the form is intentionally
 * omitted from the skeleton so the interactive inputs don't render twice.
 */
export function PreviewSkeleton() {
  return (
    <div className={hpStyles.previewSectionContent} aria-busy="true" aria-label="Загрузка примера радара">
      <div className={hpStyles.previewWorkspace}>
        <div id="preview-configurator" className={hpStyles.previewSurfaceAnchor}>
          <SurfaceCard
            className={hpStyles.previewConfigurator}
            padding="var(--preview-surface-padding)"
          >
          <div className={hpStyles.previewConfiguratorLead}>
            <h3 className={hpStyles.previewCardHeading}>Настройте пример</h3>
          </div>
          <div className={hpStyles.previewSkeletonBody}>
            <span className={hpStyles.previewSkeletonLine} />
            <span className={hpStyles.previewSkeletonLine} />
            <span className={hpStyles.previewSkeletonBar} />
          </div>
          </SurfaceCard>
        </div>
        <div id="preview-results" className={hpStyles.previewSurfaceAnchor}>
          <SurfaceCard
            className={`${hpStyles.previewCardContainer} ${hpStyles.previewResults}`}
            padding="var(--preview-surface-padding)"
          >
          <div className={hpStyles.previewHeaderRow}>
            <h3 className={hpStyles.previewCardHeading}>Пример утренней выдачи</h3>
            <StatusBadge tone="neutral" style={{ justifySelf: "start" }}>загрузка данных</StatusBadge>
          </div>
          <div className={`${hpStyles.previewSkeletonBody} ${hpStyles.previewItemsGrid}`}>
            <span className={hpStyles.previewSkeletonCard} />
            <span className={hpStyles.previewSkeletonCard} />
          </div>
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}

function PreviewDigestCard(props: {
  item: HomePreviewItem;
  defaultOpen: boolean;
}) {
  const { item, defaultOpen } = props;
  const whyNow = deriveWhyNow(item.reasons) || "";
  const contactPath = formatLawfulContactPath(item.lawfulContactPath);
  const location = formatLocationCaption(item.location_names);
  const evidenceTitles = pickEvidenceTitles(item.evidence_titles, 6);
  const vacanciesCaption = formatVacanciesCount(item.vacancies_count);
  const points = formatScorePoints(item.total_score);
  const tone = scoreTone(item.total_score);
  const pct = scorePercent(item.total_score);
  const employerName = cleanEmployerName(item.employer_name);
  const rs = item.relevanceSignals;
  const hasRelevance = rs.fit > 0 || rs.intent > 0 || rs.urgency > 0 || rs.reachability > 0;
  const confidenceRow = gateLabel(item.confidence_gate) || null;
  const sourceCountRow = item.sourceCount > 0 ? `${item.sourceCount} ${pluralSources(item.sourceCount)}` : null;
  const contactRow = contactPath || null;
  const detailWhat = whyNow || vacanciesCaption || "Активность найма подтверждена источниками";
  const detailNext = item.opener?.trim() || (contactPath ? "Проверить корпоративный путь контакта" : "Уточнить контакт и предложить помощь по открытому найму");
  const freshness = formatVacancyFreshness(item.latest_published_at);
  const fitPct = Math.round(rs.fit * 100);
  const fitLabel = rs.fit >= 0.75 ? "Высокое" : rs.fit >= 0.5 ? "Среднее" : rs.fit > 0 ? "Низкое" : "Нет данных";
  const strengthLabel = pct >= 75 ? "Сильная" : pct >= 50 ? "Умеренная" : "Слабая";
  const freshnessLabel = freshness ? (freshness.includes("сегодня") || freshness.includes("1 день") || freshness.includes("за 2") || freshness.includes("за 3") ? "Сегодня" : freshness.includes("недел") ? "Эта неделя" : "Ранее") : "Нет даты";
  const intentPct = hasRelevance ? Math.round(rs.intent * 100) : pct;
  const intentLabel = hasRelevance
    ? intentPct >= 75
      ? "Высокое"
      : intentPct >= 50
        ? "Среднее"
        : "Нужно подтвердить"
    : strengthLabel;
  const urgencyPct = hasRelevance ? Math.round(rs.urgency * 100) : freshness ? 88 : 30;
  const reachabilityPct = hasRelevance ? Math.round(rs.reachability * 100) : contactPath ? 82 : 28;
  const reachabilityLabel = reachabilityPct >= 75 ? "Высокая" : reachabilityPct >= 50 ? "Средняя" : "Нужно уточнить";
  const detailMoment = [
    sourceCountRow ? `Подтверждение: ${sourceCountRow}.` : null,
    freshness ? `Последнее изменение — ${freshness}.` : null,
  ].filter(Boolean).join(" ") || "Сигнал требует дополнительной проверки актуальности.";
  const detailContact = contactPath
    ? `${contactPath}. Решение об обращении остаётся за вами.`
    : "Корпоративный путь контакта нужно уточнить до обращения.";
  const evidenceItems = buildPreviewEvidenceItems({
    whyNow,
    vacanciesCaption,
    evidenceTitles,
    sourceFamilies: item.source_families,
    limit: 3,
  });
  const summaryMeta = [location, vacanciesCaption].filter(Boolean).join(" · ");

  return (
    <details
      className={hpStyles.previewLeadCard}
      data-lead-card="true"
      data-tone={tone}
      name="preview-leads"
      open={defaultOpen}
      data-animated-details
    >
      <summary className={hpStyles.previewLeadSummary}>
        <span className={hpStyles.previewLeadSummaryCompany}>
          <strong>{employerName}</strong>
          {summaryMeta ? <span>{summaryMeta}</span> : null}
        </span>
        <span className={hpStyles.previewLeadSummarySignal}>{detailWhat}</span>
        <span className={hpStyles.previewLeadSummaryScore}><strong>{points}</strong><span>/100</span></span>
        <svg className={hpStyles.previewLeadChevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>

      <div className={hpStyles.previewLeadBody}>
        <div className={hpStyles.previewLeadRecommendationRow}>
          <span>Рекомендация на сегодня</span>
          <div className={hpStyles.previewLeadChips}>
            {confidenceRow ? <span data-gate={item.confidence_gate}>{confidenceRow}</span> : null}
            {sourceCountRow ? <span>{sourceCountRow}</span> : null}
            {contactRow ? <span>контакт найден</span> : null}
          </div>
        </div>

        <div
          className={hpStyles.previewStrengthTrack}
          role="meter"
          aria-valuenow={Number(points)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Сила сигнала: ${points} из 100`}
        >
          <span className={hpStyles.previewStrengthFill} data-tone={tone} style={{ width: `${pct}%` }} />
        </div>

        <div className={hpStyles.previewLeadEvidence}>
          <div><span>Что изменилось</span><p>{detailWhat}</p></div>
          <div><span>Почему сейчас</span><p>{detailMoment}</p></div>
          <div><span>Контакт</span><p>{detailContact}</p></div>
        </div>

        <div className={hpStyles.previewLeadMeters} aria-label="Оценка рекомендации">
          <LeadMeter label="Соответствие" secondaryLabel="Fit" description="Насколько компания совпадает с нишей, ролями и географией профиля." value={hasRelevance ? fitPct : 0} valueLabel={hasRelevance ? fitLabel : "После настройки"} />
          <LeadMeter label="Намерение" secondaryLabel="Intent" description="Насколько факты подтверждают активное намерение компании нанимать." value={intentPct} valueLabel={intentLabel} />
          <LeadMeter label="Актуальность" secondaryLabel="Urgency" description="Насколько свеж сигнал и сохраняется ли подходящий момент для обращения." value={urgencyPct} valueLabel={freshnessLabel} />
          <LeadMeter label="Доступность" secondaryLabel="Reachability" description="Есть ли законный корпоративный путь контакта без персональных данных." value={reachabilityPct} valueLabel={reachabilityLabel} />
        </div>

        {evidenceItems.length > 0 ? (
          <div className={hpStyles.previewLeadFacts}>
            <span>Факты и источники</span>
            <ul>{evidenceItems.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
          </div>
        ) : null}

        <div className={hpStyles.previewLeadNextStep}>
          <div><span>Следующий шаг</span><strong>{detailNext}</strong></div>
          <span className={hpStyles.previewLeadSafety}>Без автоматической отправки</span>
        </div>

        {item.negativeSignals.length > 0 ? (
          <div className={hpStyles.previewCaveats}>
            <h4>Что проверить перед контактом</h4>
            <ul>{item.negativeSignals.slice(0, 3).map((signal) => <li key={signal}>{signal}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function LeadMeter(props: {
  label: string;
  secondaryLabel: string;
  description: string;
  value: number;
  valueLabel: string;
}) {
  return (
    <div className={hpStyles.previewLeadMeter}>
      <FiurPopover
        label={props.label}
        secondaryLabel={props.secondaryLabel}
        description={props.description}
      />
      <span className={hpStyles.previewLeadMeterTrack} aria-hidden="true"><span style={{ width: `${props.value}%` }} /></span>
      <strong>{props.valueLabel}</strong>
    </div>
  );
}

function formatCompaniesCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun = mod10 === 1 && mod100 !== 11
    ? "компания"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
      ? "компании"
      : "компаний";

  return `${count} ${noun}`;
}

/** Russian plural for "источник" by count — 1 / 2–4 / 5+. */
function pluralSources(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "источник";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "источника";
  return "источников";
}

/**
 * Map a confidence gate (A/B/C/D — the evidence-quality contract from
 * lib/scoring/gates) to a short Russian label for the public lead card. Returns
 * null for an absent/unknown gate so the caller hides the row instead of
 * showing a raw letter or an English bucket. Mirrors the "Уверенность" copy in
 * the hero lead-format card so the public preview and product explanation agree.
 */
function gateLabel(gate: string | null | undefined): string | null {
  switch (gate) {
    case "A":
      return "Подтверждено";
    case "B":
      return "Скорее подтверждено";
    case "C":
      return "Нужна проверка";
    case "D":
      return "Контекст без прямого найма";
    default:
      return null;
  }
}
