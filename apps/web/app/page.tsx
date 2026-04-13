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
import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  StatusBadge,
  SurfaceCard,
  disclosureBodyStyle,
  disclosureStyle,
  disclosureSummaryStyle,
  fieldStyle,
  fieldLabelStyle,
  helperTextStyle,
  inputStyle,
  primaryActionStyle,
  secondaryActionStyle
} from "./ui/page-primitives";
import {
  buildFaqItems,
  chipToneStyle,
  featureDotStyle,
  featureRowStyle,
  faqAnswerStyle,
  faqCardStyle,
  faqSummaryStyle,
  formatVacanciesCount,
  heroFootnoteStyle,
  heroGridStyle,
  heroStatGridStyle,
  heroStatLabelStyle,
  heroStatValueStyle,
  heroTextStyle,
  heroTitleStyle,
  mutedPanelStyle,
  planDescriptionStyle,
  primaryPlanCardStyle,
  pricingGridStyle,
  previewCardHeaderStyle,
  previewCardStyle,
  previewGridStyle,
  previewHeaderRowStyle,
  previewReasonListStyle,
  proofGridStyle,
  proofItemStyle,
  scorePillStyle,
  secondaryPlanCardStyle,
  stepTextStyle,
  stepTitleStyle,
  stepsGridStyle,
  topBarStyle,
  openerBoxStyle,
  openerLabelStyle
} from "./home-page-components";

export const dynamic = "force-dynamic";

const VISIBLE_PREVIEW_ITEMS = 2;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type HomePreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

const heroProofItems = [
  "Ежедневный радар по живому найму",
  "Понятно, почему компания в фокусе",
  "Готовый угол первого контакта"
] as const;

const heroStats = [
  {
    value: "1 день",
    label: "до первого радара"
  },
  {
    value: "3 шага",
    label: "от примера до запуска"
  },
  {
    value: "0 CRM",
    label: "лишней настройки и тяжёлой админки"
  }
] as const;

const heroSignalRows = [
  {
    label: "Сигнал",
    value: "живой найм по нескольким ролям"
  },
  {
    label: "Почему сейчас",
    value: "новые вакансии, свежая активность, понятный повод для контакта"
  },
  {
    label: "Следующий шаг",
    value: "короткий выход с упором на скорость и релевантных кандидатов"
  }
] as const;

const valueItems = [
  {
    title: "Короткий список вместо длинного поиска",
    text: "На главном экране только компании, которым уже есть смысл писать сегодня."
  },
  {
    title: "Прозрачный сигнал",
    text: "По каждой компании видно, что именно сработало и почему сигнал выглядит живым."
  },
  {
    title: "Готовый next step",
    text: "Радар не просто находит компанию, а подсказывает лучший угол первого контакта."
  }
] as const;

const workflowItems = [
  {
    title: "Для соло-рекрутера",
    text: "Каждое утро открыть радар и сразу забрать в работу 3-5 самых сильных компаний."
  },
  {
    title: "Для агентства",
    text: "Держать отдельный профиль под каждую практику и быстрее находить новый спрос."
  },
  {
    title: "Для команды BD",
    text: "Работать не по холодному списку, а по компаниям с понятным поводом для выхода."
  }
] as const;

const howItWorksItems = [
  {
    step: "01",
    title: "Задайте профиль",
    text: "Город, специализация и пара ключевых слов. Этого хватает для первого результата."
  },
  {
    step: "02",
    title: "Посмотрите радар",
    text: "Сразу видно, какие компании в фокусе, почему сигнал сильный и с чего лучше заходить."
  },
  {
    step: "03",
    title: "Запустите пилот",
    text: "Профиль переносится в пилот. Дальше остаётся подключить Telegram и получать радар каждый день."
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
      <header style={topBarStyle}>
        <div style={{ display: "grid", gap: "4px" }}>
          <div style={{ fontSize: "1.08rem", fontWeight: 800 }}>Recruiter Radar</div>
          <div style={{ color: "#64748b", fontSize: "0.92rem" }}>
            Ежедневный радар по компаниям с активным наймом
          </div>
        </div>

        <a href="#preview" style={secondaryActionStyle}>
          Посмотреть пример
        </a>
      </header>

      <section style={heroGridStyle}>
        <SurfaceCard
          style={{
            display: "grid",
            gap: "22px",
            padding: "34px",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(239,246,255,0.94) 100%)"
          }}
        >
          <StatusBadge tone="success">Сначала пример. Потом решение.</StatusBadge>

          <div style={{ display: "grid", gap: "12px" }}>
            <h1 style={heroTitleStyle}>Компании, которым стоит написать сегодня.</h1>
            <p style={heroTextStyle}>
              Recruiter Radar каждый день находит работодателей с живым наймом, показывает
              причину сигнала и подсказывает лучший угол первого контакта.
            </p>
          </div>

          <div style={proofGridStyle}>
            {heroProofItems.map((item) => (
              <div key={item} style={proofItemStyle}>
                <span style={featureDotStyle} />
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a href="#preview" style={primaryActionStyle}>
              Открыть пример радара
            </a>
            <Link href={checkoutHref} style={secondaryActionStyle}>
              Запустить пилот на 7 дней
            </Link>
          </div>

          <div style={heroStatGridStyle}>
            {heroStats.map((item) => (
              <div key={item.label} style={mutedPanelStyle}>
                <div style={heroStatValueStyle}>{item.value}</div>
                <div style={heroStatLabelStyle}>{item.label}</div>
              </div>
            ))}
          </div>

          <div style={heroFootnoteStyle}>
            Не CRM и не база “на всякий случай”. Это рабочий радар, который каждый день поднимает
            только те компании, где уже есть повод выйти в контакт.
          </div>
        </SurfaceCard>

        <SurfaceCard
          style={{
            display: "grid",
            gap: "16px",
            padding: "26px",
            background: "linear-gradient(180deg, #0f172a 0%, #172554 100%)",
            color: "#f8fafc",
            border: "1px solid rgba(59, 130, 246, 0.18)"
          }}
        >
          <div style={{ display: "grid", gap: "6px" }}>
            <div
              style={{
                color: "rgba(191, 219, 254, 0.9)",
                fontSize: "0.78rem",
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase"
              }}
            >
              Пример сигнала
            </div>
            <div style={{ fontSize: "1.28rem", fontWeight: 800 }}>Northline Recruiting Ops</div>
            <div style={{ color: "#cbd5e1", lineHeight: 1.6 }}>
              Компания в активной фазе найма. Есть свежие роли и понятный повод для первого выхода.
            </div>
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            {heroSignalRows.map((item) => (
              <div
                key={item.label}
                style={{
                  display: "grid",
                  gap: "4px",
                  padding: "14px 16px",
                  borderRadius: "18px",
                  backgroundColor: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(148, 163, 184, 0.16)"
                }}
              >
                <div style={{ color: "#93c5fd", fontSize: "0.78rem", fontWeight: 700 }}>{item.label}</div>
                <div style={{ color: "#f8fafc", lineHeight: 1.55 }}>{item.value}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gap: "8px",
              padding: "16px",
              borderRadius: "18px",
              background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)",
              border: "1px solid rgba(191, 219, 254, 0.18)"
            }}
          >
            <div style={{ color: "#93c5fd", fontSize: "0.78rem", fontWeight: 700 }}>Что получает пользователь</div>
            <div style={{ color: "#e2e8f0", lineHeight: 1.6 }}>
              Не просто список компаний, а уже упакованный повод для контакта и приоритет на сегодня.
            </div>
          </div>
        </SurfaceCard>
      </section>

      <section style={{ display: "grid", gap: "16px" }}>
        <SectionIntro
          eyebrow="Что получает команда"
          title="Продукт, который помогает продавать подбор быстрее"
          description="Коротко, прозрачно и без тяжёлого внедрения."
        />

        <div style={stepsGridStyle}>
          {valueItems.map((item) => (
            <SurfaceCard
              key={item.title}
              style={{ display: "grid", gap: "10px", padding: "24px", background: "rgba(255,255,255,0.84)" }}
            >
              <h3 style={stepTitleStyle}>{item.title}</h3>
              <p style={stepTextStyle}>{item.text}</p>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section id="preview" style={{ display: "grid", gap: "16px" }}>
        <SectionIntro
          eyebrow="Живой пример"
          title="Посмотрите радар под свой профиль"
          description="Задайте профиль и сразу проверьте, какие компании стоит брать в работу сегодня."
        />

        <div style={previewGridStyle}>
          <SurfaceCard style={{ display: "grid", gap: "14px", alignContent: "start", padding: "24px" }}>
            <div style={{ display: "grid", gap: "6px" }}>
              <div style={{ fontWeight: 700, fontSize: "1.08rem" }}>Параметры профиля</div>
              <div style={helperTextStyle}>Только то, что реально влияет на подборку.</div>
            </div>

            <form method="GET" action="/" style={{ display: "grid", gap: "14px" }}>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Специализация</span>
                <input
                  name="specialization"
                  defaultValue={previewInput.specialization}
                  placeholder="IT-рекрутмент / подбор в продажи"
                  style={inputStyle}
                />
              </label>

              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>География</span>
                <input
                  name="targetCity"
                  defaultValue={previewInput.targetCity}
                  placeholder="Москва / Берлин / удалённо"
                  style={inputStyle}
                />
              </label>

              <details style={disclosureStyle}>
                <summary style={disclosureSummaryStyle}>Уточнить профиль</summary>
                <div style={disclosureBodyStyle}>
                  <label style={fieldStyle}>
                    <span style={fieldLabelStyle}>Компаний в день</span>
                    <input
                      name="dailyDigestLimit"
                      type="number"
                      min={1}
                      max={10}
                      defaultValue={previewInput.dailyDigestLimit}
                      style={inputStyle}
                    />
                    <span style={helperTextStyle}>От 1 до 10 компаний в одном радаре.</span>
                  </label>

                  <label style={fieldStyle}>
                    <span style={fieldLabelStyle}>Усилить фокус</span>
                    <input
                      name="includeKeywords"
                      defaultValue={previewInput.includeKeywords}
                      placeholder="рекрутер, сорсинг, агентство"
                      style={inputStyle}
                    />
                  </label>

                  <label style={fieldStyle}>
                    <span style={fieldLabelStyle}>Исключить</span>
                    <input
                      name="excludeKeywords"
                      defaultValue={previewInput.excludeKeywords}
                      placeholder="вахта, завод, стажировка"
                      style={inputStyle}
                    />
                  </label>
                </div>
              </details>

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                <button type="submit" style={primaryActionStyle}>
                  Показать компании
                </button>

                {hasPreview ? (
                  <Link href="/" style={secondaryActionStyle}>
                    Сбросить фильтры
                  </Link>
                ) : null}
              </div>
            </form>
          </SurfaceCard>

          <SurfaceCard
            style={{
              display: "grid",
              gap: "14px",
              alignContent: "start",
              padding: "24px",
              background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.92) 100%)"
            }}
          >
            <div style={{ display: "grid", gap: "8px" }}>
              <div style={previewHeaderRowStyle}>
                <div style={{ fontWeight: 700, fontSize: "1.08rem" }}>
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

              <div style={helperTextStyle}>
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
                {visiblePreviewItems.map((item) => (
                  <PreviewDigestCard key={`${item.orgId}-${item.rank}`} item={item} />
                ))}

                {hiddenPreviewItems.length > 0 ? (
                  <details style={disclosureStyle}>
                    <summary style={disclosureSummaryStyle}>
                      Показать ещё {hiddenPreviewItems.length} компаний
                    </summary>
                    <div style={disclosureBodyStyle}>
                      <div style={{ display: "grid", gap: "12px" }}>
                        {hiddenPreviewItems.map((item) => (
                          <PreviewDigestCard key={`${item.orgId}-${item.rank}`} item={item} />
                        ))}
                      </div>
                    </div>
                  </details>
                ) : null}
              </div>
            )}

            <Link href={checkoutHref} style={primaryActionStyle}>
              {previewState.items.length > 0 ? "Получать такой радар каждый день" : "Запустить пилот"}
            </Link>
          </SurfaceCard>
        </div>
      </section>

      <section style={{ display: "grid", gap: "16px" }}>
        <SectionIntro
          eyebrow="Как это встраивается в работу"
          title="Подходит под реальный процесс команды"
          description="Не требует долгого внедрения и не заставляет менять привычный workflow."
        />

        <div style={stepsGridStyle}>
          {workflowItems.map((item) => (
            <SurfaceCard
              key={item.title}
              style={{ display: "grid", gap: "10px", padding: "24px", background: "rgba(255,255,255,0.86)" }}
            >
              <h3 style={stepTitleStyle}>{item.title}</h3>
              <p style={stepTextStyle}>{item.text}</p>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gap: "16px" }}>
        <SectionIntro
          eyebrow="Как это работает"
          title="Три шага до первого радара"
          description="От примера до ежедневной работы без лишней настройки."
        />

        <div style={stepsGridStyle}>
          {howItWorksItems.map((item) => (
            <SurfaceCard
              key={item.step}
              style={{ display: "grid", gap: "10px", padding: "24px", background: "rgba(255,255,255,0.86)" }}
            >
              <StatusBadge tone="neutral" style={{ justifySelf: "start" }}>
                {item.step}
              </StatusBadge>
              <h3 style={stepTitleStyle}>{item.title}</h3>
              <p style={stepTextStyle}>{item.text}</p>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gap: "16px" }}>
        <SectionIntro
          eyebrow="Пилот"
          title="Быстрый запуск без большого риска"
          description="Сначала пример, потом короткий пилот. Если ценность есть, переводите радар в постоянный канал."
        />

        <div style={pricingGridStyle}>
          {PUBLIC_PLANS.map((plan) => (
            <SurfaceCard
              key={plan.code}
              style={plan.isPrimary ? primaryPlanCardStyle : secondaryPlanCardStyle}
            >
              <div style={{ display: "grid", gap: "8px" }}>
                <StatusBadge tone={plan.isPrimary ? "info" : "neutral"} style={{ justifySelf: "start" }}>
                  {plan.name}
                </StatusBadge>
                <div style={{ fontSize: "2rem", fontWeight: 800 }}>{plan.price}</div>
                <div style={{ color: "#64748b" }}>{plan.cadence}</div>
                <p style={planDescriptionStyle}>{plan.description}</p>
              </div>

              <div style={{ display: "grid", gap: "10px" }}>
                {plan.bullets.map((bullet) => (
                  <div key={bullet} style={featureRowStyle}>
                    <span style={featureDotStyle} />
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>

              <Link href={checkoutHref} style={plan.isPrimary ? primaryActionStyle : secondaryActionStyle}>
                {plan.ctaLabel}
              </Link>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <section style={{ display: "grid", gap: "10px" }}>
        <SectionIntro
          eyebrow="FAQ"
          title="Коротко перед запуском"
          description="Только то, что важно для решения."
        />
        {faqItems.map((item) => (
          <details key={item.question} style={faqCardStyle}>
            <summary style={faqSummaryStyle}>{item.question}</summary>
            <div style={faqAnswerStyle}>{item.answer}</div>
          </details>
        ))}
      </section>
    </PageFrame>
  );
}

function PreviewDigestCard(props: {
  item: HomePreviewItem;
}) {
  const { item } = props;
  const probability = buildHhRadarProbabilitySummary({
    totalScore: item.total_score,
    priorityScore: item.priorityScore,
    relevanceScore: item.relevanceScore,
    timingScore: item.timingScore,
    replyLikelihoodScore: item.replyLikelihoodScore,
    confidenceScore: item.confidenceScore,
    confidenceLabel: item.confidenceLabel,
    sourceCount: item.sourceCount,
    sourceKeys: item.sourceKeys,
    structuredSignalCount: item.structuredSignalCount,
    growthSignalCount: item.growthSignalCount,
    vacanciesCount: item.vacancies_count,
    latestPublishedAt: item.latest_published_at
  });
  const primaryReason = item.reasons[0] ?? "Сейчас по компании есть повод выйти в контакт.";
  const secondaryReason = item.reasons[1] ?? null;
  const hasExtraContext = Boolean(secondaryReason) || item.curationLabels.length > 0;

  return (
    <article style={previewCardStyle}>
      <div style={previewCardHeaderStyle}>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <strong style={{ fontSize: "1.02rem" }}>
            {item.rank}. {item.employer_name}
          </strong>
          <span style={scorePillStyle}>{probability.workNowText}</span>
        </div>
        <span style={{ color: "#64748b", fontSize: "0.9rem" }}>{formatVacanciesCount(item.vacancies_count)}</span>
      </div>

      <div style={previewReasonListStyle}>
        <div style={{ color: "#667085", fontSize: "0.78rem", fontWeight: 700 }}>Почему компания в фокусе</div>
        <div>{primaryReason}</div>
      </div>

      <div style={openerBoxStyle}>
        <div style={openerLabelStyle}>Лучший следующий шаг</div>
        <div>{item.opener}</div>
      </div>

      {hasExtraContext ? (
        <details style={disclosureStyle}>
          <summary style={disclosureSummaryStyle}>Показать дополнительный контекст</summary>
          <div style={disclosureBodyStyle}>
            {secondaryReason ? <div style={helperTextStyle}>{secondaryReason}</div> : null}
            {item.curationLabels.length > 0 ? (
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {item.curationLabels.slice(0, 2).map((label) => (
                  <span key={`${item.orgId}-${label}`} style={chipToneStyle}>
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
