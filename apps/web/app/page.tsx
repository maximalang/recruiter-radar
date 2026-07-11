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
import {
  NoticeBox,
  PageFrame,
  SectionIntro,
  StatusBadge,
  SurfaceCard,
} from "./ui/page-primitives";
import ppStyles from "./page-primitives.module.css";
import {
  buildFaqItems,
  formatVacanciesCount,
} from "./home-page-components";
import hpStyles from "./home-page-components.module.css";

const GATE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  A: { color: '#065f46', bg: '#d1fae5', label: 'A — авто' },
  B: { color: '#1e40af', bg: '#dbeafe', label: 'B — авто' },
  C: { color: '#92400e', bg: '#fef3c7', label: 'C — проверка' },
  D: { color: '#4b5563', bg: '#f3f4f6', label: 'D — контекст' },
};

export const dynamic = "force-dynamic";

const VISIBLE_PREVIEW_ITEMS = 2;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type HomePreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

const heroProofItems = [
  "3 минуты — и видно, кому писать сегодня",
  "Живой hiring-proof по каждой компании",
  "Понятно, почему сейчас и готовый угол контакта"
] as const;

const heroStats = [
  {
    value: "3 минуты",
    label: "от входа до первого радара"
  },
  {
    value: "Без регистрации",
    label: "просто укажите нишу и регион"
  },
  {
    value: "0 настроек",
    label: "никакой CRM и длинного внедрения"
  }
] as const;

const heroSignalRows = [
  {
    label: "Сигнал",
    value: "живой найм по нескольким ролям, подтверждённый с разных источников"
  },
  {
    label: "Gate",
    value: "A — 2+ независимых источника, чистое совпадение"
  },
  {
    label: "Почему сейчас",
    value: "hiring burst, новый регион, дефицитная функция — понятный повод для контакта"
  },
  {
    label: "Угол контакта",
    value: "корпоративная карьерная страница + готовый оупенер"
  }
] as const;

const valueItems = [
  {
    title: "Компании, которым стоит написать сегодня",
    text: "Каждое утро — короткий список компаний с живым hiring-proof, объяснением «почему сейчас» и готовым углом контакта."
  },
  {
    title: "Доказательства, не догадки",
    text: "По каждой компании видно, какие источники подтверждают найм, какой confidence у сигнала и какие есть риски."
  },
  {
    title: "Безопасный первый контакт",
    text: "Радар подсказывает законный и рабочий путь контакта — корпоративная форма, HR-канал, карьерная страница."
  }
] as const;

const workflowItems = [
  {
    title: "Для соло-рекрутера",
    text: "Каждое утро открыть радар и сразу забрать в работу 3–5 самых сильных компаний."
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
      <a href="#main-content" className={ppStyles.skipLink}>Перейти к содержанию</a>
      <header className={hpStyles.topBar}>
        <div className={hpStyles.heroBrandName}>
          <div>Recruiter Radar</div>
          <div className={hpStyles.heroBrandSubtitle}>
            Ежедневный радар по компаниям с активным наймом
          </div>
        </div>

        <a href="#preview" className={ppStyles.secondaryAction}>
          Посмотреть пример
        </a>
      </header>

      <section id="main-content" className={hpStyles.heroGrid}>
        <SurfaceCard className={hpStyles.surfaceCardGradient}>
          <StatusBadge tone="success">Сначала пример. Потом решение.</StatusBadge>

          <div>
            <h1 className={hpStyles.heroTitle} style={{ lineHeight: "0.95" }}>Компании, которым стоит написать сегодня.</h1>
            <p className={hpStyles.heroText}>
              Recruiter Radar каждый день находит работодателей с живым наймом, показывает
              причину сигнала и подсказывает лучший угол первого контакта.
            </p>
          </div>

          <div className={hpStyles.proofGrid}>
            {heroProofItems.map((item) => (
              <div key={item} className={hpStyles.proofItem}>
                <span className={hpStyles.featureDot} />
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a href="#preview" className={ppStyles.primaryAction}>
              Открыть пример радара
            </a>
            <Link href={checkoutHref} className={ppStyles.secondaryAction}>
              Запустить пилот — 3 000 ₽
            </Link>
          </div>

          <div className={hpStyles.heroStatGrid}>
            {heroStats.map((item) => (
              <div key={item.label} className={hpStyles.mutedPanel}>
                <div className={hpStyles.heroStatValue}>{item.value}</div>
                <div className={hpStyles.heroStatLabel}>{item.label}</div>
              </div>
            ))}
          </div>

          <div className={hpStyles.heroFootnote}>
            Не CRM и не база “на всякий случай”. Это рабочий радар, который каждый день поднимает
            только те компании, где уже есть повод выйти в контакт.
          </div>
        </SurfaceCard>

        <SurfaceCard className={hpStyles.surfaceCardDark}>
          <div className={hpStyles.signalRow}>
            <div className={hpStyles.signalEyebrow}>Пример сигнала</div>
            <div className={hpStyles.signalTitle}>Northline Recruiting Ops</div>
            <div className={hpStyles.signalText}>
              Свежий найм по 3 ролям, подтверждённый из 2 источников. Gate A — можно работать сразу.
            </div>
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            {heroSignalRows.map((item) => (
              <div key={item.label} className={hpStyles.signalRow}>
                <div className={hpStyles.signalLabel}>{item.label}</div>
                <div className={hpStyles.signalValue}>{item.value}</div>
              </div>
            ))}
          </div>

          <div className={hpStyles.whatUserGetsBox}>
            <div className={hpStyles.userGetsLabel}>Что получает пользователь</div>
            <div className={hpStyles.userGetsText}>
              Компании, которым стоит написать сегодня — с confidence, доказательствами, почему сейчас и готовым углом контакта.
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

        <div className={hpStyles.stepsGrid}>
          {valueItems.map((item) => (
            <SurfaceCard
              key={item.title}
              className={hpStyles.featureSurfaceCard}
            >
              <h3 className={hpStyles.stepTitle}>{item.title}</h3>
              <p className={hpStyles.stepText}>{item.text}</p>
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
                    description="Показываем ближайшие компании по релевантности вашему ICP. На реальном радаре совпадений будет больше — sample-набор ограничен."
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
      </section>

      <section style={{ display: "grid", gap: "16px" }}>
        <SectionIntro
          eyebrow="Как это встраивается в работу"
          title="Подходит под реальный процесс команды"
          description="Не требует долгого внедрения и не заставляет менять привычный workflow."
        />

        <div className={hpStyles.stepsGrid}>
          {workflowItems.map((item) => (
            <SurfaceCard
              key={item.title}
              className={hpStyles.featureSurfaceCardAlt}
            >
              <h3 className={hpStyles.stepTitle}>{item.title}</h3>
              <p className={hpStyles.stepText}>{item.text}</p>
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

        <div className={hpStyles.stepsGrid}>
          {howItWorksItems.map((item) => (
            <SurfaceCard
              key={item.step}
              className={hpStyles.featureSurfaceCardAlt}
            >
              <StatusBadge tone="neutral" style={{ justifySelf: "start" }}>
                {item.step}
              </StatusBadge>
              <h3 className={hpStyles.stepTitle}>{item.title}</h3>
              <p className={hpStyles.stepText}>{item.text}</p>
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

        <div className={hpStyles.pricingGrid}>
          {PUBLIC_PLANS.map((plan) => (
            <SurfaceCard
              key={plan.code}
              className={plan.isPrimary ? hpStyles.primaryPlanCard : hpStyles.secondaryPlanCard}
            >
              <div className={ppStyles.planPriceContainer}>
                <StatusBadge tone={plan.isPrimary ? "info" : "neutral"} className={ppStyles.planBadge}>
                  {plan.name}
                </StatusBadge>
                <div className={ppStyles.planPrice}>{plan.price}</div>
                <div className={ppStyles.planPriceCadence}>{plan.cadence}</div>
                <p className={ppStyles.planDescription}>{plan.description}</p>
              </div>

              <div className={ppStyles.planFeatures}>
                {plan.bullets.map((bullet) => (
                  <div key={bullet} className={hpStyles.featureRow}>
                    <span className={hpStyles.featureDot} />
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>

              <Link
                href={buildCheckoutHref({ ...previewInput, planCode: plan.code })}
                className={plan.isPrimary ? ppStyles.primaryAction : ppStyles.secondaryAction}
              >
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
          <details key={item.question} className={hpStyles.faqCard}>
            <summary className={hpStyles.faqSummary}>{item.question}</summary>
            <div className={hpStyles.faqAnswer}>{item.answer}</div>
          </details>
        ))}
      </section>

      <section style={{ display: "grid", gap: "16px" }}>
        <SectionIntro
          eyebrow="Как вы получите доступ"
          title="Доступ — цифровой, без физической доставки"
          description="Recruiter Radar — онлайн-сервис. После оплаты доступ открывается онлайн."
        />
        <div className={hpStyles.stepsGrid}>
          {deliverySteps.map((item) => (
            <SurfaceCard key={item.step} className={hpStyles.featureSurfaceCard}>
              <div className={hpStyles.stepNumber}>{item.step}</div>
              <h3 className={hpStyles.stepTitle}>{item.title}</h3>
              <p className={hpStyles.stepText}>{item.text}</p>
            </SurfaceCard>
          ))}
        </div>
      </section>

      <footer className={hpStyles.siteFooter}>
        <div className={hpStyles.footerBrand}>
          <div className={hpStyles.footerBrandName}>Recruiter Radar</div>
          <div className={hpStyles.footerBrandSub}>Ежедневный радар по компаниям с активным наймом</div>
        </div>
        <nav className={hpStyles.footerLinks}>
          <Link href="/legal" className={hpStyles.footerLink}>Реквизиты</Link>
          <Link href="/terms" className={hpStyles.footerLink}>Оферта</Link>
          <a href="mailto:6uunn9@gmail.com" className={hpStyles.footerLink}>6uunn9@gmail.com</a>
        </nav>
        <div className={hpStyles.footerLegal}>
          Оператор — Головий Наталья Ярославна, самозанятый (НПД). ИНН 622809740837.
          Оплата через ЮKassa, чек по ФЗ-54.
        </div>
        <div className={hpStyles.footerCopy}>
          © {new Date().getFullYear()} Recruiter Radar
        </div>
      </footer>
    </PageFrame>
  );
}

const deliverySteps = [
  {
    step: "01",
    title: "Оплата тарифа",
    text: "Оплачиваете выбранный тариф через ЮKassa. Чек с ИНН самозанятого приходит автоматически."
  },
  {
    step: "02",
    title: "Активация профиля",
    text: "Получаете ссылку на активацию: указываете город, специализацию и ключевые слова поиска."
  },
  {
    step: "03",
    title: "Доставка в Telegram",
    text: "Подключаете Telegram за 2 минуты — и каждый день получаете радар с компаниями."
  },
] as const;

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
        Оценка релевантности вашему ICP
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
          {item.confidence_gate && item.confidence_gate in GATE_CONFIG && (
            <span className={ppStyles.gateBadge} data-gate={item.confidence_gate}>
              {GATE_CONFIG[item.confidence_gate].label}
            </span>
          )}
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
