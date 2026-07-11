import Link from "next/link";

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
import RadarCanvas from "./radar-canvas";
import ScrollReveal from "./scroll-reveal";
import ScrollProgress from "./scroll-progress";

export const dynamic = "force-dynamic";

const VISIBLE_PREVIEW_ITEMS = 2;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type HomePreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

const heroTrust = [
  { value: "Только подтверждённый найм", label: "живые доказательства, не список «на всякий случай»" },
  { value: "2 990 ₽ за пилот", label: "чек самозанятого, оплата через ЮKassa" },
] as const;

const howItWorksItems = [
  {
    step: "01",
    title: "Задайте профиль",
    text: "Город, специализация, пара ключевых слов."
  },
  {
    step: "02",
    title: "Посмотрите пример",
    text: "Видно, кто нанимает, почему и с чего начинать разговор."
  },
  {
    step: "03",
    title: "Подключите Telegram",
    text: "Радар приходит каждый день. Отметки «беру» / «мимо» его доучивают."
  }
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

  return (
    <PageFrame maxWidth="1160px">
      <ScrollProgress />
      <a href="#main-content" className={ppStyles.skipLink}>Перейти к содержанию</a>
      <header className={hpStyles.topBar}>
        <div className={hpStyles.brandMark}>
          <span className={hpStyles.brandLiveDot} aria-hidden="true" />
          <div className={hpStyles.heroBrandName}>
            <div>Recruiter Radar</div>
            <div className={hpStyles.heroBrandSubtitle}>
              Ежедневный радар по компаниям с активным наймом
            </div>
          </div>
        </div>

        <a href="#preview" className={ppStyles.secondaryAction}>
          Посмотреть пример
        </a>
      </header>

      <section id="main-content" className={hpStyles.heroSection} aria-label="Recruiter Radar">
        <RadarCanvas />
        <div className={hpStyles.heroContent}>
          <span className={hpStyles.heroEyebrow}>Для рекрутинговых агентств и BD-команд</span>
          <h1 className={hpStyles.heroTitle}>Радар компаний, которые нанимают прямо сейчас.</h1>
          <p className={hpStyles.heroSubtitle}>
            Короткий список нанимающих компаний — с готовым поводом для контакта. Каждый день в Telegram.
          </p>
          <div className={hpStyles.heroActions}>
            <a href="#preview" className={ppStyles.primaryAction}>
              Открыть пример радара
            </a>
            <Link href={checkoutHref} className={ppStyles.secondaryAction}>
              Запустить пилот — 2 990 ₽
            </Link>
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

      <ScrollReveal as="section" id="preview" className={hpStyles.scrollSection}>
        <SectionIntro
          eyebrow="Живой пример"
          title="Так выглядит утренний радар"
          description="Каждое утро — несколько компаний. По каждой: почему мы знаем про найм, с чего начать разговор и какой есть риск. Задайте город и специализацию — это те же данные, что приходят в Telegram."
        />

        <div className={hpStyles.previewGrid}>
          <SurfaceCard className={hpStyles.previewCardContainer}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "var(--fs-lg)" }}>Параметры профиля</div>
              <div className={ppStyles.helperText}>Только то, что реально влияет на подборку.</div>
            </div>

            <form method="GET" action="/" style={{ display: "grid", gap: "14px" }}>
              <label htmlFor="specialization" className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>Специализация</span>
                <input
                  id="specialization"
                  name="specialization"
                  defaultValue={previewInput.specialization}
                  placeholder="Промышленный подбор / финансы C-level / массовый найм"
                  className={ppStyles.input}
                />
              </label>

              <label htmlFor="targetCity" className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>География</span>
                <input
                  id="targetCity"
                  name="targetCity"
                  defaultValue={previewInput.targetCity}
                  placeholder="Москва / Берлин / удалённо"
                  className={ppStyles.input}
                />
              </label>

              <details className={ppStyles.disclosure}>
                <summary className={ppStyles.disclosureSummary}>Уточнить профиль</summary>
                <div className={ppStyles.disclosureBody}>
                  <label htmlFor="dailyDigestLimit" className={ppStyles.field}>
                    <span className={ppStyles.fieldLabel}>Компаний в день</span>
                    <input
                      id="dailyDigestLimit"
                      name="dailyDigestLimit"
                      type="number"
                      min={1}
                      max={10}
                      defaultValue={previewInput.dailyDigestLimit}
                      className={ppStyles.input}
                    />
                    <span className={ppStyles.helperText}>От 1 до 10 компаний в одном радаре.</span>
                  </label>

                  <label htmlFor="includeKeywords" className={ppStyles.field}>
                    <span className={ppStyles.fieldLabel}>Усилить фокус</span>
                    <input
                      id="includeKeywords"
                      name="includeKeywords"
                      defaultValue={previewInput.includeKeywords}
                      placeholder="рекрутер, сорсинг, агентство"
                      className={ppStyles.input}
                    />
                  </label>

                  <label htmlFor="excludeKeywords" className={ppStyles.field}>
                    <span className={ppStyles.fieldLabel}>Исключить</span>
                    <input
                      id="excludeKeywords"
                      name="excludeKeywords"
                      defaultValue={previewInput.excludeKeywords}
                      placeholder="вахта, завод, стажировка"
                      className={ppStyles.input}
                    />
                  </label>
                </div>
              </details>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                <button type="submit" className={ppStyles.primaryAction}>
                  Показать компании
                </button>

                {hasPreview ? (
                  <Link href="/" className={ppStyles.secondaryAction}>
                    Сбросить фильтры
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

              <div className={ppStyles.helperText}>
                {hasPreview
                  ? "Так выглядит верх радара на сегодня."
                  : "Ниже пример того, что получает пользователь в рабочем радаре."}
              </div>
            </div>

            {previewState.items.length === 0 ? (
              <NoticeBox
                tone="neutral"
                title="Пока нет сильных совпадений"
                description="Попробуйте расширить географию, убрать часть исключений или ослабить фильтр."
              />
            ) : (
              <div style={{ display: "grid", gap: "12px" }}>
                {previewState.isPersonalized && !previewState.hasExactMatches ? (
                  <NoticeBox
                    tone="neutral"
                    title="Точных совпадений по нише пока нет"
                    description="Показываем ближайшие по релевантности компании. На реальном радаре совпадений будет больше — в примере выборка ограничена."
                  />
                ) : null}
                {visiblePreviewItems.map((item) => (
                  <PreviewDigestCard
                    key={`${item.org_id}-${item.rank}`}
                    item={item}
                    showRelevance={previewState.isPersonalized}
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
                            showRelevance={previewState.isPersonalized}
                          />
                        ))}
                      </div>
                    </div>
                  </details>
                ) : null}
              </div>
            )}

            <Link href={checkoutHref} className={ppStyles.primaryAction}>
              {previewState.items.length > 0 ? "Получать такой радар каждый день" : "Запустить пилот"}
            </Link>
          </SurfaceCard>
        </div>
      </ScrollReveal>

      <ScrollReveal as="section" className={hpStyles.scrollSection}>
        <SectionIntro
          eyebrow="Как это работает"
          title="Три шага до первого радара"
          description="От примера до ежедневной работы без лишней настройки."
        />

        <div className={hpStyles.stepsGrid}>
          {howItWorksItems.map((item) => (
            <SurfaceCard
              key={item.step}
              className={hpStyles.featureSurfaceCardAlt}
            >
              <span className={hpStyles.stepBadge}>{item.step}</span>
              <h3 className={hpStyles.stepTitle}>{item.title}</h3>
              <p className={hpStyles.stepText}>{item.text}</p>
            </SurfaceCard>
          ))}
        </div>
      </ScrollReveal>

      <ScrollReveal as="section" className={hpStyles.scrollSection}>
        <SectionIntro
          eyebrow="Тарифы"
          title="Один продукт — три срока"
          description="Возможности везде одинаковые. Отличается только срок."
        />

        <div className={hpStyles.pricingGrid}>
          {PUBLIC_PLANS.map((plan) => {
            const isYearly = plan.code === "yearly";
            const isFeatured = plan.isPrimary;
            return (
              <SurfaceCard
                key={plan.code}
                className={isFeatured ? hpStyles.primaryPlanCard : hpStyles.secondaryPlanCard}
              >
                {isFeatured ? (
                  <span className={hpStyles.planFlag}>Рекомендуем начать</span>
                ) : null}
                <div className={ppStyles.planPriceContainer}>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <StatusBadge tone={isFeatured ? "info" : "neutral"} className={ppStyles.planBadge}>
                      {plan.name}
                    </StatusBadge>
                    {isYearly ? (
                      <span className={hpStyles.savingsBadge}>выгода 89 890 ₽</span>
                    ) : null}
                  </div>
                  <div className={hpStyles.planPriceRow}>
                    <span className={ppStyles.planPrice}>{plan.price}</span>
                    {isYearly ? (
                      <span className={hpStyles.planPriceSmall}>~7 499 ₽/мес</span>
                    ) : null}
                  </div>
                  <div className={ppStyles.planPriceCadence}>{plan.cadence}</div>
                </div>

                <Link
                  href={buildCheckoutHref({ ...previewInput, planCode: plan.code })}
                  className={isFeatured ? ppStyles.primaryAction : ppStyles.secondaryAction}
                >
                  {plan.ctaLabel}
                </Link>
              </SurfaceCard>
            );
          })}
        </div>

        <div className={hpStyles.includedOnce}>
          <div className={hpStyles.includedOnceLabel}>В любой тариф входит</div>
          <ul className={hpStyles.includedOnceList}>
            {PUBLIC_PLANS[0].bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <p className={ppStyles.helperText} style={{ marginTop: "4px" }}>
            Оплата через ЮKassa, чек по ФЗ-54. Условия — в{" "}
            <Link href="/terms" style={{ color: "var(--c-brand)", textDecoration: "underline" }}>оферте</Link>.
          </p>
        </div>
      </ScrollReveal>

      <ScrollReveal as="section" className={hpStyles.scrollSection}>
        <SectionIntro
          eyebrow="FAQ"
          title="Коротко перед запуском"
          description="Только то, что важно для решения."
        />
        {faqItems.map((item) => (
          <details key={item.question} className={hpStyles.faqCard}>
            <summary className={hpStyles.faqSummary}>{item.question}</summary>
            <div className={hpStyles.faqAnswer}>{item.answer}</div>
          </details>
        ))}
      </ScrollReveal>

      <footer className={hpStyles.siteFooter}>
        <div className={hpStyles.footerTop}>
          <div className={hpStyles.footerBrand}>
            <div className={hpStyles.footerBrandName}>Recruiter Radar</div>
            <div className={hpStyles.footerBrandSub}>
              Ежедневный радар по компаниям с активным наймом. Доставка в Telegram.
            </div>
          </div>

          <div className={hpStyles.footerOperator}>
            <div className={hpStyles.footerOperatorLabel}>Оператор сервиса</div>
            <div className={hpStyles.footerOperatorRow}>
              <strong>Головий Наталья Ярославна</strong>
            </div>
            <div className={hpStyles.footerOperatorRow}>
              <span>Самозанятый, плательщик НПД</span>
              <span className={hpStyles.footerOperatorSep}>·</span>
              <span>ИНН <span className={hpStyles.footerOperatorInn}>622809740837</span></span>
            </div>
            <div className={hpStyles.footerOperatorRow}>
              <span>Оплата через ЮKassa, чек по ФЗ-54</span>
              <span className={hpStyles.footerOperatorSep}>·</span>
              <a href="mailto:6uunn9@gmail.com" style={{ color: "inherit", textDecoration: "underline" }}>6uunn9@gmail.com</a>
            </div>
          </div>
        </div>

        <nav className={hpStyles.footerLinks}>
          <Link href="/legal" className={hpStyles.footerLink}>Реквизиты</Link>
          <Link href="/terms" className={hpStyles.footerLink}>Оферта</Link>
          <Link href="/privacy" className={hpStyles.footerLink}>Конфиденциальность</Link>
          <Link href="/admin" className={hpStyles.footerLink}>Панель оператора</Link>
        </nav>

        <div className={hpStyles.footerCopy}>
          © {new Date().getFullYear()} Recruiter Radar
        </div>
      </footer>
    </PageFrame>
  );
}

const RELEVANCE_AXES: Array<{ key: keyof HomePreviewItem["relevanceSignals"]; label: string }> = [
  { key: "fit", label: "Соответствие" },
  { key: "intent", label: "Намерение" },
  { key: "urgency", label: "Срочность" },
  { key: "reachability", label: "Доступность" },
];

function PreviewRelevanceBars(props: { signals: HomePreviewItem["relevanceSignals"] }) {
  const { signals } = props;
  const hasAny = RELEVANCE_AXES.some((axis) => signals[axis.key] > 0);
  if (!hasAny) return null;

  return (
    <div className={hpStyles.previewReasonList}>
      <div style={{ color: "#667085", fontSize: "0.78rem", fontWeight: 700 }}>
        Оценка релевантности вашему профилю
      </div>
      <div style={{ display: "grid", gap: "6px" }}>
        {RELEVANCE_AXES.map((axis) => {
          const value = Math.round(signals[axis.key] * 100);
          return (
            <div
              key={axis.key}
              style={{ display: "grid", gridTemplateColumns: "92px 1fr 34px", gap: "8px", alignItems: "center" }}
            >
              <span style={{ fontSize: "0.74rem", color: "#475467" }}>{axis.label}</span>
              <span
                aria-hidden
                style={{ height: "6px", borderRadius: "999px", background: "#eaecf0", overflow: "hidden" }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${value}%`,
                    borderRadius: "999px",
                    background: "var(--accent, #2563eb)",
                  }}
                />
              </span>
              <span style={{ fontSize: "0.72rem", color: "#667085", textAlign: "right" }}>{value}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewDigestCard(props: {
  item: HomePreviewItem;
  showRelevance?: boolean;
}) {
  const { item, showRelevance } = props;
  const probability = buildHhRadarProbabilitySummary({
    totalScore: item.total_score
  });
  const gatePresentation = getGatePresentation(item.confidence_gate);
  const whyNow = item.reasons[0] || "";
  const contactPath = formatLawfulContactPath(item.lawfulContactPath);
  const negativeSignals = item.negativeSignals;
  const secondaryReason = item.reasons[1] || null;
  const hasExtraContext = Boolean(secondaryReason) || item.curationLabels.length > 0;

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

      {showRelevance ? <PreviewRelevanceBars signals={item.relevanceSignals} /> : null}

      {contactPath ? (
        <div className={hpStyles.previewReasonList}>
          <div style={{ color: "#667085", fontSize: "0.78rem", fontWeight: 700 }}>Безопасный путь контакта</div>
          <div>{contactPath}</div>
        </div>
      ) : null}

      {negativeSignals.length > 0 ? (
        <div className={hpStyles.previewReasonList}>
          <div style={{ color: "#b42318", fontSize: "0.78rem", fontWeight: 700 }}>Факторы риска</div>
          <ul style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "4px" }}>
            {negativeSignals.slice(0, 2).map((signal) => (
              <li key={signal}>{signal}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasExtraContext ? (
        <details className={ppStyles.disclosure}>
          <summary className={ppStyles.disclosureSummary}>Показать дополнительный контекст</summary>
          <div className={ppStyles.disclosureBody}>
            {secondaryReason ? <div className={ppStyles.helperText}>{secondaryReason}</div> : null}
            {item.curationLabels.length > 0 ? (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {item.curationLabels.slice(0, 2).map((label) => (
                  <span key={`${item.org_id}-${label}`} className={hpStyles.chipTone}>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}
