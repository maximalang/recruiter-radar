import Link from "next/link";
import type { Metadata } from "next";

import { getPaymentProviderSetupState } from "../lib/payments";
import {
  PUBLIC_PLANS,
  buildCheckoutHref,
  getPublicSampleDigestState,
  hasPublicPreviewInput,
  readPublicPreviewInput
} from "../lib/publicProduct";
import { buildHhRadarProbabilitySummary } from "../lib/hhProbabilities";
import { formatLawfulContactPath } from "../lib/leads-data";
import { getGatePresentation } from "../lib/scoring/gate-labels";
import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  StatusBadge,
  SurfaceCard,
} from "./ui/page-primitives";
import ppStyles from "./ui/page-primitives.module.css";
import {
  buildFaqItems,
  formatVacanciesCount,
} from "./home-page-components";
import hpStyles from "./home-page-components.module.css";
import {
  CheckIcon,
  ShieldIcon,
  MailIcon,
} from "./ui/icons";
import RadarCanvas from "./radar-canvas";
import ScrollReveal from "./scroll-reveal";
import ScrollProgress from "./scroll-progress";
import { SiteFooter } from "./ui/site-footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recruiter Radar — ежедневный радар по нанимающим компаниям",
  description:
    "Короткий список компаний с активным наймом и готовым поводом для контакта. Каждый день в Telegram. Для рекрутинговых агентств и BD-команд.",
};

const VISIBLE_PREVIEW_ITEMS = 2;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type HomePreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

const heroTrust = [
  { value: "Только подтверждённый найм", label: "доказательства, а не «возможно, нанимают»" },
  { value: "5 минут на старт", label: "профиль, Telegram — и утренний радар готов" },
] as const;

const principles = [
  {
    icon: CheckIcon,
    title: "Только подтверждённый найм",
    text: "Карьерная страница, свежие вакансии, независимый источник. Не агрегат «возможно, нанимают».",
  },
  {
    icon: ShieldIcon,
    title: "Оценка уверенности",
    text: "Уровень доверия A–D и честный «почему сейчас» — до первого касания.",
  },
  {
    icon: MailIcon,
    title: "Безопасный путь контакта",
    text: "Корпоративный сайт, карьерная страница, HR-почта. Без личных адресов вслепую.",
  },
] as const;

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const previewInput = readPublicPreviewInput(resolvedSearchParams);
  const previewState = await getPublicSampleDigestState(previewInput);
  const hasPreview = hasPublicPreviewInput(previewInput);
  const checkoutHref = buildCheckoutHref(previewInput);
  const paymentSetup = getPaymentProviderSetupState();
  const faqItems = buildFaqItems(paymentSetup.configured);
  const visiblePreviewItems = previewState.items.slice(0, VISIBLE_PREVIEW_ITEMS);
  const hiddenPreviewItems = previewState.items.slice(VISIBLE_PREVIEW_ITEMS);
  const pilotPlan = PUBLIC_PLANS.find((p) => p.code === "pilot") ?? PUBLIC_PLANS[0];
  const secondaryPlans = PUBLIC_PLANS.filter((p) => p.code !== "pilot");

  return (
    <PageFrame maxWidth="1160px">
      <ScrollProgress />
      <a href="#main-content" className={ppStyles.skipLink}>Перейти к содержанию</a>

      {/* Sticky top nav */}
      <header className={hpStyles.topBar}>
        <a href="/" className={hpStyles.brandMark} style={{ textDecoration: "none" }}>
          <span className={hpStyles.brandDot} aria-hidden="true" />
          <div>
            <div className={hpStyles.heroBrandName}>Recruiter Radar</div>
            <div className={hpStyles.heroBrandSubtitle}>
              радар по компаниям с активным наймом
            </div>
          </div>
        </a>
        <nav className={hpStyles.topNavLinks} aria-label="Разделы лендинга">
          <a href="#preview" className={hpStyles.topNavLink}>Пример</a>
          <a href="#pricing" className={hpStyles.topNavLink}>Тарифы</a>
          <a href="#faq" className={hpStyles.topNavLink}>FAQ</a>
          <Link href={checkoutHref} className={hpStyles.topNavCta}>
            Активировать неделю
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section id="main-content" className={hpStyles.heroSection} aria-label="Recruiter Radar">
        <RadarCanvas />
        <div className={hpStyles.heroContent}>
          <span className={hpStyles.heroKicker}>
            <span className={hpStyles.heroKickerDot} aria-hidden="true" />
            Ежедневный радар по компаниям с активным наймом
          </span>
          <h1 className={hpStyles.heroTitle}>
            Компании, которым стоит написать{" "}
            <span className={hpStyles.heroTitleAccent}>сегодня</span>.
          </h1>
          <p className={hpStyles.heroSubtitle}>
            Каждый день — короткий список нанимающих компаний с поводом для контакта.
            Доказательства найма, оценка уверенности и безопасный путь контакта — в Telegram.
          </p>
          <div className={hpStyles.heroActions}>
            <a href="#preview" className={hpStyles.heroCta}>
              Открыть пример радара
              <svg className={hpStyles.heroCtaArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="13 6 19 12 13 18" />
              </svg>
            </a>
          </div>
          <div className={hpStyles.heroTrust}>
            {heroTrust.map((item) => (
              <div key={item.label} className={hpStyles.heroTrustItem}>
                <div className={hpStyles.heroTrustValue}>{item.value}</div>
                <div className={hpStyles.heroTrustLabel}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Principles / value row */}
      <ScrollReveal as="section" className={hpStyles.scrollSection}>
        <SectionIntro
          title="Доверие вместо шума"
        />
        <div className={hpStyles.principles}>
          {principles.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.title} className={hpStyles.principle}>
                <span className={hpStyles.principleIcon}>
                  <Icon />
                </span>
                <h3 className={hpStyles.principleTitle}>{p.title}</h3>
                <p className={hpStyles.principleText}>{p.text}</p>
              </div>
            );
          })}
        </div>
      </ScrollReveal>

      {/* Live preview */}
      <ScrollReveal as="section" id="preview" className={hpStyles.scrollSection}>
        <SectionIntro
          title="Так выглядит утренний радар"
          description="Задайте город и специализацию — это те же данные, что приходят в Telegram."
        />

        <div className={hpStyles.previewGrid}>
          <SurfaceCard className={hpStyles.previewCardContainer}>
            <div style={{ fontWeight: 700, fontSize: "var(--fs-lg)" }}>Параметры профиля</div>

            <form method="GET" action="/" style={{ display: "grid", gap: "14px" }}>
              <label htmlFor="specialization" className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>Специализация</span>
                <input
                  id="specialization"
                  name="specialization"
                  defaultValue={previewInput.specialization}
                  placeholder="Промышленный подбор / финансы C-level"
                  className={ppStyles.input}
                />
              </label>

              <label htmlFor="targetCity" className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>География</span>
                <input
                  id="targetCity"
                  name="targetCity"
                  defaultValue={previewInput.targetCity}
                  placeholder="Москва / удалённо"
                  className={ppStyles.input}
                />
              </label>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                <button type="submit" className={ppStyles.primaryAction}>
                  Показать компании
                </button>

                {hasPreview ? (
                  <Link href="/" className={ppStyles.secondaryAction}>
                    Сбросить
                  </Link>
                ) : null}
              </div>
            </form>
          </SurfaceCard>

          <SurfaceCard className={hpStyles.previewCardContainer}>
            <div>
              <div className={hpStyles.previewHeaderRow}>
                <div style={{ fontWeight: 700, fontSize: "var(--fs-lg)" }}>
                  {hasPreview ? "Радар для выбранного профиля" : "Как выглядит ежедневный радар"}
                </div>
                <StatusBadge tone={previewState.isPersonalized ? "info" : "neutral"} style={{ justifySelf: "start" }}>
                  {previewState.isPersonalized
                    ? previewState.items.length > 0
                      ? "по вашему профилю"
                      : "пока без совпадений"
                    : previewState.isLive
                      ? "живой пример"
                      : "демо"}
                </StatusBadge>
              </div>
            </div>

            {previewState.items.length === 0 ? (
              <NoticeBox
                tone="neutral"
                title="Пока нет сильных совпадений"
                description="Расширьте географию или ослабьте фильтр."
              />
            ) : (
              <div style={{ display: "grid", gap: "12px" }}>
                {previewState.isPersonalized && !previewState.hasExactMatches ? (
                  <NoticeBox
                    tone="neutral"
                    title="Точных совпадений по нише пока нет"
                    description="Показываем ближайшие по релевантности. На реальном радаре совпадений больше."
                  />
                ) : null}
                {visiblePreviewItems.map((item) => (
                  <PreviewDigestCard
                    key={`${item.org_id}-${item.rank}`}
                    item={item}
                  />
                ))}

                {hiddenPreviewItems.length > 0 ? (
                  <details className={ppStyles.disclosure}>
                    <summary className={ppStyles.disclosureSummary}>
                      Показать ещё {hiddenPreviewItems.length} компаний
                    </summary>
                    <div className={ppStyles.disclosureBody}>
                      <div style={{ display: "grid", gap: "12px" }}>
                        {hiddenPreviewItems.map((item) => (
                          <PreviewDigestCard
                            key={`${item.org_id}-${item.rank}`}
                            item={item}
                          />
                        ))}
                      </div>
                    </div>
                  </details>
                ) : null}
              </div>
            )}

            <Link href={checkoutHref} className={ppStyles.primaryAction}>
              {previewState.items.length > 0 ? "Получать такой радар каждый день" : "Попробовать неделю"}
            </Link>
          </SurfaceCard>
        </div>
      </ScrollReveal>

      {/* Pricing — hierarchy: primary week plan, then secondary plans */}
      <ScrollReveal as="section" id="pricing" className={hpStyles.scrollSection}>
        <SectionIntro
          eyebrow="Тарифы"
          title="Один продукт — три срока"
        />

        <div className={hpStyles.pricingGrid}>
          <SurfaceCard
            key={pilotPlan.code}
            className={hpStyles.primaryPlanCard}
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
              <span className={hpStyles.planFlag}>Рекомендуем начать</span>
            </div>
            <p style={{ margin: 0, color: "var(--c-text-secondary)", fontSize: "0.94rem", lineHeight: 1.6 }}>
              {pilotPlan.description}
            </p>
            <Link
              href={buildCheckoutHref({ ...previewInput, planCode: pilotPlan.code })}
              className={ppStyles.primaryAction}
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
                  className={hpStyles.secondaryPlanCard}
                >
                  <div className={ppStyles.planPriceContainer}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <StatusBadge tone="neutral" className={ppStyles.planBadge}>
                        {plan.name}
                      </StatusBadge>
                      {isQuarterly ? (
                        <span className={hpStyles.savingsBadge}>выгода 14 980 ₽</span>
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
                  <Link
                    href={buildCheckoutHref({ ...previewInput, planCode: plan.code })}
                    className={ppStyles.secondaryAction}
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
          title="Коротко перед запуском"
        />
        {faqItems.map((item) => (
          <details key={item.question} className={hpStyles.faqCard}>
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
        <h2 className={hpStyles.closingTitle}>Начните неделю с радаром в Telegram</h2>
        <p className={hpStyles.closingText}>
          Семь дней ежедневного радара и профиль под вашу нишу.
        </p>
        <div className={hpStyles.closingActions}>
          <Link href={checkoutHref} className={hpStyles.heroCta}>
            Активировать неделю — 2 990 ₽
          </Link>
        </div>
      </section>

      <SiteFooter />
    </PageFrame>
  );
}

function PreviewDigestCard(props: {
  item: HomePreviewItem;
}) {
  const { item } = props;
  const probability = buildHhRadarProbabilitySummary({
    totalScore: item.total_score
  });
  const gatePresentation = getGatePresentation(item.confidence_gate);
  const whyNow = item.reasons[0] || "";
  const contactPath = formatLawfulContactPath(item.lawfulContactPath);

  return (
    <article className={hpStyles.previewCard}>
      <div className={hpStyles.previewCardHeader}>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <strong style={{ fontSize: "var(--fs-base)" }}>
            {item.rank}. {item.employer_name}
          </strong>
          <span className={hpStyles.scorePill}>{probability.workNowText}</span>
          {gatePresentation ? (
            <span className={ppStyles.gateBadge} data-gate={item.confidence_gate}>
              {gatePresentation.label}
            </span>
          ) : null}
        </div>
        <span className={hpStyles.vacanciesCount}>{formatVacanciesCount(item.vacancies_count)}</span>
      </div>

      {whyNow ? (
        <div className={hpStyles.previewReasonList}>
          <div style={{ color: "#667085", fontSize: "0.78rem", fontWeight: 700 }}>Почему сейчас</div>
          <div>{whyNow}</div>
        </div>
      ) : null}

      {contactPath ? (
        <div className={hpStyles.previewReasonList}>
          <div style={{ color: "#667085", fontSize: "0.78rem", fontWeight: 700 }}>Безопасный путь контакта</div>
          <div>{contactPath}</div>
        </div>
      ) : null}
    </article>
  );
}
