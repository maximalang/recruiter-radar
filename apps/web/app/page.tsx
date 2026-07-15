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
  pickEvidenceTitles,
} from "./home-page-components";
import hpStyles from "./home-page-components.module.css";
import {
  CheckIcon,
  ShieldIcon,
  MailIcon,
} from "./ui/icons";
import LandingHeader from "./landing-header";
import RadarCanvas from "./radar-canvas";
import ScrollReveal from "./scroll-reveal";
import ScrollProgress from "./scroll-progress";
import { SiteFooter } from "./ui/site-footer";
import { BrandLogo } from "./ui/brand-logo";

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

const principles = [
  {
    icon: CheckIcon,
    title: "Сигнал, а не список вакансий",
    text: "Радар выделяет изменение: новый найм, рост команды или редкую для компании роль — и показывает, когда это произошло.",
  },
  {
    icon: ShieldIcon,
    title: "Доказательства можно проверить",
    text: "У каждого вывода есть источники, дата и уровень уверенности. Вы видите основание рекомендации до первого касания.",
  },
  {
    icon: MailIcon,
    title: "Следующий шаг уже понятен",
    text: "В карточке есть деловой повод и корректный корпоративный путь контакта — без личных адресов и массовой рассылки.",
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
      <div className={hpStyles.ambientBg} aria-hidden="true">
        <span className={hpStyles.ambientGrid} />
      </div>
      <a href="#main-content" className={ppStyles.skipLink}>Перейти к содержанию</a>

      {/* Hero */}
      <section id="main-content" className={hpStyles.heroSection} aria-label="Recruiter Radar">
        <RadarCanvas />
        <div className={hpStyles.heroContent}>
          <div className={hpStyles.heroCopy}>
            <BrandLogo className={hpStyles.heroLogo} tone="dark" />
            <div className={hpStyles.heroEyebrow}>
              <span className={hpStyles.heroEyebrowDot} aria-hidden="true" />
              Радар клиентских возможностей
            </div>
            <h1 className={hpStyles.heroTitle}>
              Компании, которым нужен подбор — <span className={hpStyles.heroTitleAccent}>в момент, когда стоит написать</span>
            </h1>
            <p className={hpStyles.heroSubtitle}>
              Каждое утро — несколько компаний под специализацию вашего агентства.
              Вы сразу видите повод для обращения, силу сигнала и следующий шаг.
            </p>
            <div className={hpStyles.heroActions}>
              <a href="#preview" className={hpStyles.heroCta}>
                Посмотреть пример радара
                <svg className={hpStyles.heroCtaArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="13 6 19 12 13 18" />
                </svg>
              </a>
              <a href="#pricing" className={hpStyles.heroSecondaryCta}>Тарифы</a>
            </div>
            <p className={hpStyles.heroFootnote}>Настройка профиля за 5 минут · доставка в Telegram</p>
          </div>

          <div className={hpStyles.heroProduct} aria-label="Как Recruiter Radar оценивает компанию">
            <div className={hpStyles.heroProductTopbar}>
              <span className={hpStyles.heroProductLabel}>Пример структуры сигнала</span>
              <span className={hpStyles.heroProductLive}>демо</span>
            </div>
            <div className={hpStyles.heroCompanyRow}>
              <div>
                <div className={hpStyles.heroCompanyName}>Компания в вашем ICP</div>
                <div className={hpStyles.heroCompanyMeta}>Москва · производство</div>
              </div>
              <div className={hpStyles.heroScore}><strong>87</strong><span>/100</span></div>
            </div>
            <div className={hpStyles.heroScoreTrack}><span /></div>
            <div className={hpStyles.heroSignalBlock}>
              <span>Почему сейчас</span>
              <strong>Открыты новые вакансии по вашей специализации</strong>
            </div>
            <div className={hpStyles.heroEvidenceRow}>
              <div><span>01</span><p>Карьерная страница</p></div>
              <div><span>02</span><p>Свежие вакансии</p></div>
              <div><span>03</span><p>Корпоративный контакт</p></div>
            </div>
            <div className={hpStyles.heroProductFooter}>
              <span>Доказательства собраны</span>
              <strong>Можно действовать</strong>
            </div>
          </div>

        </div>
      </section>

      <LandingHeader />

      {/* Principles / value row */}
      <ScrollReveal as="section" className={hpStyles.scrollSection}>
        <SectionIntro
          eyebrow="Что внутри"
          title="От сигнала к следующему действию"
          description="Карточка отвечает на три вопроса: что изменилось, почему этому можно доверять и как корректно выйти на компанию."
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
          eyebrow="Пример результата"
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
                    : previewState.isLive && previewState.items.length > 0
                      ? "актуальные данные"
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
                    description="Показываем ближайшие по релевантности. Уточните профиль или расширьте специализацию."
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
        <h2 className={hpStyles.closingTitle}>Настройте первый радар</h2>
        <p className={hpStyles.closingText}>
          Укажите специализацию и географию. После запуска первый список придёт в Telegram.
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
  // `whyNow` joins the top structured reasons (deriveWhyNow picks urgency/
  // intent components ordered by evidential strength). On prod the reasons are
  // legacy free-form Russian strings ("86 вакансий, включая «…»"); parseReasons
  // now wraps those as a `legacy` reason whose full text renders verbatim, so
  // the card shows the human copy instead of the `[legacy.…]` debug stub. The
  // reason text already carries the time anchor ("Опубликовано 12.07"), so a
  // separate "Свежесть" row would duplicate it — one "Почему сейчас" line is
  // enough.
  const whyNow = deriveWhyNow(item.reasons) || "";
  const contactPath = formatLawfulContactPath(item.lawfulContactPath);
  const location = formatLocationCaption(item.location_names);
  const evidenceTitles = pickEvidenceTitles(item.evidence_titles, 6);
  const vacanciesCaption = formatVacanciesCount(item.vacancies_count);
  const evidenceItems = buildPreviewEvidenceItems({
    whyNow,
    vacanciesCaption,
    evidenceTitles,
    sourceFamilies: item.source_families,
  });
  // Score = 0–100 points (raw total_score / 4). The internal [0,4] signal
  // strength still drives the tone + the confidence gate + the hiringIntentMin
  // threshold (unchanged) — points are a higher-resolution read of the SAME
  // value, so a 75-point lead is exactly the "горячий" 3.0-of-4 cut. `points`
  // is the headline number, `tone` colors it + the bar, `pct` fills the bar.
  const points = formatScorePoints(item.total_score);
  const tone = scoreTone(item.total_score);
  const pct = scorePercent(item.total_score);
  // Clean employer name — strip the legal-form wrapper quotes/brackets that read
  // as noise ("АО "ГОСТИНИЦА "СОВЕТСКАЯ"" → "ГОСТИНИЦА «СОВЕТСКАЯ»"). Best-effort:
  // if the name is all-caps legal boilerplate we keep it, just trim.
  const employerName = cleanEmployerName(item.employer_name);
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
      <div className={hpStyles.previewCardTopbar}>
        <span>Сигнал радара · {String(item.rank).padStart(2, "0")}</span>
        {location ? (
          <span className={hpStyles.previewCardLoc} aria-label={`География: ${location}`}>{location}</span>
        ) : null}
      </div>

      <div className={hpStyles.previewCompanyRow}>
        <div className={hpStyles.previewCardName}>{employerName}</div>
        <div className={hpStyles.previewScore}>
          <strong>{points}</strong><span>/100</span>
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

      {whyNow ? (
        <div className={hpStyles.previewWhy}>
          <span>Почему сейчас</span>
          <strong>{whyNow}</strong>
        </div>
      ) : null}

      <div className={hpStyles.previewEvidence} aria-label="Доказательства сигнала">
        {evidenceItems.map((itemText, index) => (
          <div key={`${itemText}-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <p>{itemText}</p>
          </div>
        ))}
      </div>

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

      {contactPath ? (
        <div className={hpStyles.previewFooter}>
          <span>Корпоративный контакт</span>
          <strong>{contactPath}</strong>
        </div>
      ) : null}
    </article>
  );
}
