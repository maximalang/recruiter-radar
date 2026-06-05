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
} from "./ui/page-primitives";
import ppStyles from "./ui/page-primitives.module.css";
import {
  buildFaqItems,
  formatVacanciesCount,
} from "./home-page-components";
import hpStyles from "./home-page-components.module.css";

export const dynamic = "force-dynamic";

const VISIBLE_PREVIEW_ITEMS = 2;

type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type HomePreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

const heroProofItems = [
  "Живой hiring-proof по каждой компании",
  "Понятно, почему сейчас и почему вам",
  "Безопасный путь первого контакта"
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
    value: "живой найм по нескольким ролям, подтверждённый с разных источников"
  },
  {
    label: "Почему сейчас",
    value: "hiring burst, новый регион, дефицитная функция — понятный повод для контакта"
  },
  {
    label: "Следующий шаг",
    value: "корпоративный контакт и готовый угол первого сообщения"
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

      <section className={hpStyles.heroGrid}>
        <SurfaceCard className={hpStyles.surfaceCardGradient}>
          <StatusBadge tone="success">Сначала пример. Потом решение.</StatusBadge>

          <div>
            <h1 className={hpStyles.heroTitle}>Компании, которым стоит написать сегодня.</h1>
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
              Запустить пилот на 7 дней
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
              Компания в активной фазе найма. Есть свежие роли и понятный повод для первого выхода.
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
              <div style={{ fontWeight: 700, fontSize: "1.08rem" }}>Параметры профиля</div>
              <div className={ppStyles.helperText}>Только то, что реально влияет на подборку.</div>
            </div>

            <form method="GET" action="/" style={{ display: "grid", gap: "14px" }}>
              <label className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>Специализация</span>
                <input
                  name="specialization"
                  defaultValue={previewInput.specialization}
                  placeholder="IT-рекрутмент / подбор в продажи"
                  className={ppStyles.input}
                />
              </label>

              <label className={ppStyles.field}>
                <span className={ppStyles.fieldLabel}>География</span>
                <input
                  name="targetCity"
                  defaultValue={previewInput.targetCity}
                  placeholder="Москва / Берлин / удалённо"
                  className={ppStyles.input}
                />
              </label>

              <details className={ppStyles.disclosure}>
                <summary className={ppStyles.disclosureSummary}>Уточнить профиль</summary>
                <div className={ppStyles.disclosureBody}>
                  <label className={ppStyles.field}>
                    <span className={ppStyles.fieldLabel}>Компаний в день</span>
                    <input
                      name="dailyDigestLimit"
                      type="number"
                      min={1}
                      max={10}
                      defaultValue={previewInput.dailyDigestLimit}
                      className={ppStyles.input}
                    />
                    <span className={ppStyles.helperText}>От 1 до 10 компаний в одном радаре.</span>
                  </label>

                  <label className={ppStyles.field}>
                    <span className={ppStyles.fieldLabel}>Усилить фокус</span>
                    <input
                      name="includeKeywords"
                      defaultValue={previewInput.includeKeywords}
                      placeholder="рекрутер, сорсинг, агентство"
                      className={ppStyles.input}
                    />
                  </label>

                  <label className={ppStyles.field}>
                    <span className={ppStyles.fieldLabel}>Исключить</span>
                    <input
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
                {visiblePreviewItems.map((item) => (
                  <PreviewDigestCard key={`${item.org_id}-${item.rank}`} item={item} />
                ))}

                {hiddenPreviewItems.length > 0 ? (
                  <details className={ppStyles.disclosure}>
                    <summary className={ppStyles.disclosureSummary}>
                      Показать ещё {hiddenPreviewItems.length} компаний
                    </summary>
                    <div className={ppStyles.disclosureBody}>
                      <div style={{ display: "grid", gap: "12px" }}>
                        {hiddenPreviewItems.map((item) => (
                          <PreviewDigestCard key={`${item.org_id}-${item.rank}`} item={item} />
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
              <div style={{ display: "grid", gap: "8px" }}>
                <StatusBadge tone={plan.isPrimary ? "info" : "neutral"} style={{ justifySelf: "start" }}>
                  {plan.name}
                </StatusBadge>
                <div style={{ fontSize: "2rem", fontWeight: 800 }}>{plan.price}</div>
                <div style={{ color: "#64748b" }}>{plan.cadence}</div>
                <p className={hpStyles.planDescription}>{plan.description}</p>
              </div>

              <div style={{ display: "grid", gap: "10px" }}>
                {plan.bullets.map((bullet) => (
                  <div key={bullet} className={hpStyles.featureRow}>
                    <span className={hpStyles.featureDot} />
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>

              <Link href={checkoutHref} className={plan.isPrimary ? ppStyles.primaryAction : ppStyles.secondaryAction}>
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
  const primaryReason = item.reasons[0] ?? "Сейчас по компании есть повод выйти в контакт.";
  const secondaryReason = item.reasons[1] ?? null;
  const hasExtraContext = Boolean(secondaryReason) || item.curationLabels.length > 0;

  return (
    <article className={hpStyles.previewCard}>
      <div className={hpStyles.previewCardHeader}>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <strong style={{ fontSize: "1.02rem" }}>
            {item.rank}. {item.employer_name}
          </strong>
          <span className={hpStyles.scorePill}>{probability.workNowText}</span>
        </div>
        <span style={{ color: "#64748b", fontSize: "0.9rem" }}>{formatVacanciesCount(item.vacancies_count)}</span>
      </div>

      <div className={hpStyles.previewReasonList}>
        <div style={{ color: "#667085", fontSize: "0.78rem", fontWeight: 700 }}>Почему компания в фокусе</div>
        <div>{primaryReason}</div>
      </div>

      <div className={hpStyles.openerBox}>
        <div className={hpStyles.openerLabel}>Лучший следующий шаг</div>
        <div>{item.opener}</div>
      </div>

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
