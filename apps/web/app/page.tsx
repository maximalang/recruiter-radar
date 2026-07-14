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
import { formatSignalStrength, scorePercent, scoreTone } from "../lib/scoring/score-display";
import { formatLawfulContactPath, deriveWhyNow } from "../lib/leads-data";
import { getGatePresentation } from "../lib/scoring/gate-labels";
import { formatVacanciesCount } from "../lib/format/plural";
import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  StatusBadge,
  SurfaceCard,
} from "./ui/page-primitives";
import ppStyles from "./ui/page-primitives.module.css";
import { ScoreBandChip } from "./ui/internal-page";
import {
  buildFaqItems,
  formatLocationCaption,
  pickEvidenceTitles,
} from "./home-page-components";
import hpStyles from "./home-page-components.module.css";
import {
  CheckIcon,
  ShieldIcon,
  MailIcon,
  RadarLogo,
} from "./ui/icons";
import RadarCanvas from "./radar-canvas";
import ScrollReveal from "./scroll-reveal";
import ScrollProgress from "./scroll-progress";
import { SiteFooter } from "./ui/site-footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recruiter Radar — ежедневный радар по нанимающим компаниям",
  description:
    "Каждое утро — короткий список компаний с подтверждённым наймом: что меняется, почему сейчас и как выйти на них корректно. Доставка в Telegram. Для рекрутинговых агентств и BD-команд.",
};

const VISIBLE_PREVIEW_ITEMS = 2;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type HomePreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

const heroTrust = [
  { value: "Только подтверждённый найм", label: "карьерная страница и свежие вакансии — не агрегатор «возможно, нанимают»" },
  { value: "Готово за 5 минут", label: "профиль и Telegram — утром приходит первый радар" },
] as const;

const principles = [
  {
    icon: CheckIcon,
    title: "Только подтверждённый найм",
    text: "Карьерная страница, свежие вакансии, независимый источник. Видно, кого и зачем ищут — не догадки агрегатора.",
  },
  {
    icon: ShieldIcon,
    title: "Понятная оценка уверенности",
    text: "«Подтверждено», «скорее подтверждено» или «нужна проверка» — и понятный «почему сейчас» до первого касания.",
  },
  {
    icon: MailIcon,
    title: "Безопасный путь контакта",
    text: "Корпоративный сайт, карьерная страница, HR-почта. Без личных адресов наугад.",
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
      {/* Animated ambient background — a living field of drifting blue glows +
          a faint scanning grid behind every section. Decorative only;
          pointer-events:none + z-index:0 keep it behind content (pageFrameInner
          is z-index:1). Honors prefers-reduced-motion (static) via the keyframe
          guard. The pageFrame is transparent, so this layer is finally visible
          (the old opaque pageFrame gradient hid it). */}
      <div className={hpStyles.ambientBg} aria-hidden="true">
        <span className={hpStyles.ambientGrid} />
        <span className={hpStyles.ambientBlobA} />
        <span className={hpStyles.ambientBlobB} />
        <span className={hpStyles.ambientBlobC} />
      </div>
      <a href="#main-content" className={ppStyles.skipLink}>Перейти к содержанию</a>

      {/* Sticky top nav */}
      <header className={hpStyles.topBar}>
        <a href="/" className={hpStyles.brandMark} style={{ textDecoration: "none" }}>
          <RadarLogo className={hpStyles.brandLogo} animate aria-hidden="true" />
          <div>
            <div className={hpStyles.heroBrandName}>Recruiter Radar</div>
          </div>
        </a>
        <nav className={hpStyles.topNavLinks} aria-label="Разделы лендинга">
          <span className={hpStyles.topNavAnchors}>
            <a href="#preview" className={hpStyles.topNavLink}>Пример</a>
            <a href="#pricing" className={hpStyles.topNavLink}>Тарифы</a>
            <a href="#faq" className={hpStyles.topNavLink}>FAQ</a>
          </span>
          <Link href={checkoutHref} className={hpStyles.topNavCta}>
            <span className={hpStyles.topNavCtaFull}>Активировать неделю</span>
            <span className={hpStyles.topNavCtaShort} aria-hidden="true">Активировать</span>
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section id="main-content" className={hpStyles.heroSection} aria-label="Recruiter Radar">
        <RadarCanvas />
        <div className={hpStyles.heroContent}>
          <h1 className={hpStyles.heroTitle}>
            Компании, которым стоит написать{" "}
            <span className={hpStyles.heroTitleAccent}>сегодня</span>.
          </h1>
          <p className={hpStyles.heroSubtitle}>
            Каждое утро — короткий список компаний с подтверждённым наймом: что
            изменилось, почему сейчас и как выйти на них корректно. Доказательства,
            оценка уверенности и безопасный путь контакта — в Telegram.
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
          eyebrow="Что внутри"
          title="Доверие вместо шума"
          description="Каждая компания в радаре доказана и оценена. Три правила, по которым мы её отбираем, — до того, как она попадёт к вам."
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
          eyebrow="Живой пример"
          title="Так выглядит утренний радар"
          description="Задайте город и специализацию — справа появится тот самый список, что утром приходит в Telegram."
        />

        <div className={hpStyles.previewGrid}>
          <SurfaceCard className={hpStyles.previewCardContainer}>
            <div className={hpStyles.previewCardHeading}>Параметры профиля</div>

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
                  Посмотреть компании
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
                <div className={hpStyles.previewCardHeading}>
                  {hasPreview ? "Радар для вашего профиля" : "Как выглядит радар"}
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
                title="Пока нет совпадений"
                description="Расширьте географию или смягчите специализацию — и список обновится."
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
              {previewState.items.length > 0 ? "Получать такой радар каждое утро" : "Попробовать неделю"}
            </Link>
          </SurfaceCard>
        </div>
      </ScrollReveal>

      {/* Pricing — hierarchy: primary week plan, then secondary plans */}
      <ScrollReveal as="section" id="pricing" className={hpStyles.scrollSection}>
        <SectionIntro
          eyebrow="Тарифы"
          title="Один радар — на неделю, месяц или квартал"
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
            <p className={hpStyles.planDescription}>{pilotPlan.description}</p>
            <Link
              href={buildCheckoutHref({ ...previewInput, planCode: pilotPlan.code })}
              className={`${ppStyles.primaryAction} ${hpStyles.planCta}`}
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
                  <p className={hpStyles.planDescription}>{plan.description}</p>
                  <Link
                    href={buildCheckoutHref({ ...previewInput, planCode: plan.code })}
                    className={`${ppStyles.secondaryAction} ${hpStyles.planCta}`}
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
          eyebrow="Перед запуском"
          title="Коротко о порядке"
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
        <h2 className={hpStyles.closingTitle}>Завтра утром — первый радар</h2>
        <p className={hpStyles.closingText}>
          Неделя ежедневного радара по вашей нише: компании с подтверждённым наймом,
          оценка уверенности и безопасный путь контакта. Профиль настраивается за пять минут.
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
  const gatePresentation = getGatePresentation(item.confidence_gate);
  // `whyNow` joins the top structured reasons (deriveWhyNow picks urgency/
  // intent components ordered by evidential strength). The reason labels already
  // carry the time anchor ("Несколько свежих вакансий за 14 дней"), so a
  // separate "Свежесть" row would duplicate it — one "Почему сейчас" line is
  // enough and reads cleaner.
  const whyNow = deriveWhyNow(item.reasons) || item.reasons[0] || "";
  const contactPath = formatLawfulContactPath(item.lawfulContactPath);
  const location = formatLocationCaption(item.location_names);
  const evidenceTitles = pickEvidenceTitles(item.evidence_titles, 3);
  const vacanciesCaption = formatVacanciesCount(item.vacancies_count);
  // Score scale stays [0,4] — shared lib/scoring/score-display primitives,
  // same numbers as the profile threshold and /leads bar. `strength` is the
  // numeric readout, `tone` colors the chip + bar, `pct` fills the bar.
  const strength = formatSignalStrength(item.total_score);
  const tone = scoreTone(item.total_score);
  const pct = scorePercent(item.total_score);
  // ICP-relevance breakdown — only shown when the preview was personalised
  // (the user typed a specialization/city). When there's no ICP input the
  // signals are all 0 (defaultRelevanceSignals), so the block would show empty
  // dots — hide it rather than fabricate a "match". Each axis ∈ [0,1]; the four
  // dots are the FIUR axes, the honest "is this company a fit for YOUR agency"
  // signal. Russian labels — this is a Russia-first product.
  const rs = item.relevanceSignals;
  const hasRelevance = rs.fit > 0 || rs.intent > 0 || rs.urgency > 0 || rs.reachability > 0;
  const relevanceAxes: ReadonlyArray<{ key: string; label: string; value: number }> = [
    { key: "fit", label: "Соответствие", value: rs.fit },
    { key: "intent", label: "Намерение", value: rs.intent },
    { key: "urgency", label: "Срочность", value: rs.urgency },
    { key: "reachability", label: "Доступность", value: rs.reachability },
  ];

  return (
    <article className={hpStyles.previewCard} data-tone={tone}>
      {/* Header — rank + company name (the "who"), location right-aligned (the
          "where"). Name gets the full visual weight. */}
      <div className={hpStyles.previewCardHeader}>
        <div className={hpStyles.previewCardName}>
          <span className={hpStyles.previewCardRank} aria-hidden="true">{item.rank}</span>
          {item.employer_name}
        </div>
        {location ? (
          <span className={hpStyles.previewCardLoc} aria-label={`География: ${location}`}>
            {location}
          </span>
        ) : null}
      </div>

      {/* Score + gate — one-glance temperature. Chip = word
          ("Горячий"/"Тёплый"/"Холодный"); gate = confidence stamp; meter =
          measurable [0,4] bar so the value isn't just a word. */}
      <div className={hpStyles.previewScoreLine}>
        <ScoreBandChip score={item.total_score} />
        {gatePresentation ? (
          <span className={hpStyles.previewCardGate} data-gate={item.confidence_gate}>
            {gatePresentation.label}
          </span>
        ) : null}
        <div
          className={hpStyles.previewStrengthMeter}
          role="meter"
          aria-valuenow={Number(strength)}
          aria-valuemin={0}
          aria-valuemax={4}
          aria-label={`Сила сигнала: ${strength} из 4`}
          title={`Сила сигнала: ${strength} из 4`}
        >
          <span className={hpStyles.previewStrengthNumber} data-tone={tone}>{strength}</span>
          <span className={hpStyles.previewStrengthTrack}>
            <span className={hpStyles.previewStrengthFill} data-tone={tone} style={{ width: `${pct}%` }} />
          </span>
        </div>
      </div>

      {/* Evidence — the vacancy count (the scale of hiring) + real vacancy
          titles (the proof behind "this company is hiring"), capped at 3,
          de-duplicated. The count + titles together answer "what and how
          much" — more substantive than either alone. */}
      <div className={hpStyles.previewEvidence}>
        {vacanciesCaption ? (
          <span className={hpStyles.previewEvidenceCount}>{vacanciesCaption}</span>
        ) : null}
        {evidenceTitles.map((title, idx) => (
          <span key={`${title}-${idx}`} className={hpStyles.previewEvidenceChip}>
            {title}
          </span>
        ))}
      </div>

      {/* Why now — the single "what changed" line (freshness is encoded in the
          reason label, no separate row to avoid duplication). */}
      {whyNow ? (
        <div className={hpStyles.previewReason}>
          <span className={hpStyles.previewReasonKey}>Почему сейчас</span>
          <span className={hpStyles.previewReasonVal}>{whyNow}</span>
        </div>
      ) : null}

      {/* ICP-relevance — the "is this a fit for YOUR agency" signal on the four
          FIUR axes. Only for personalised previews (hasRelevance). Russian
          labels. The conceptual core: "why fit THIS agency", not just "is
          hiring". */}
      {hasRelevance ? (
        <div className={hpStyles.previewRelevance} aria-label="Релевантность вашему ICP по осям">
          <span className={hpStyles.previewReasonKey}>Релевантность ICP</span>
          <div className={hpStyles.previewRelevanceAxes}>
            {relevanceAxes.map((axis) => (
              <span key={axis.key} className={hpStyles.previewRelevanceAxis} aria-label={`${axis.label}: ${Math.round(axis.value * 100)}%`}>
                <span className={hpStyles.previewRelevanceAxisLabel}>{axis.label}</span>
                <span className={hpStyles.previewRelevanceDots}>
                  {[0.25, 0.5, 0.75, 1].map((threshold) => (
                    <span
                      key={threshold}
                      className={hpStyles.previewRelevanceDot}
                      data-on={axis.value >= threshold ? "true" : "false"}
                      aria-hidden="true"
                    />
                  ))}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Contact — the safest non-personal path, one line. */}
      {contactPath ? (
        <div className={hpStyles.previewReason}>
          <span className={hpStyles.previewReasonKey}>Контакт</span>
          <span className={hpStyles.previewReasonVal}>{contactPath}</span>
        </div>
      ) : null}
    </article>
  );
}
