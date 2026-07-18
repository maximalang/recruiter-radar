import Link from "next/link";
import type { Metadata } from "next";

import { getPaymentProviderSetupState } from "../lib/payments";
import {
  PUBLIC_PLANS,
  PUBLIC_PREVIEW_FIELD_LIMITS,
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
            <div className={hpStyles.heroEvidenceBadge}>
              <span>Сигнал подтверждён</span>
              <b>2 источника · контакт найден</b>
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
            <div className={hpStyles.heroProductFooter}>
              <span>Рекомендуемое действие</span>
              <strong>Проверить контакт сегодня</strong>
            </div>
          </div>

        </div>

        <div className={hpStyles.heroMetrics}>
          <div className={hpStyles.heroMetric}><strong>3–7</strong><span>компаний с наивысшим приоритетом</span></div>
          <div className={hpStyles.heroMetric}><strong>1 карточка</strong><span>сигнал, доказательства, контакт и следующий шаг</span></div>
          <div className={hpStyles.heroMetric}><strong>0 автоспама</strong><span>решение об обращении всегда за вами</span></div>
        </div>
      </section>

      <LandingHeader />

      {/* Principles / value row */}
      <ScrollReveal as="section" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Что внутри"
          title="От сигнала к следующему действию"
          description="Карточка отвечает на три вопроса: что изменилось, почему этому можно доверять и как корректно выйти на компанию."
        />
        <div className={hpStyles.principles}>
          {principles.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.title} className={`${hpStyles.principle} ${hpStyles.revealCard}`}>
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

      {/* Problem — why this radar exists */}
      <ScrollReveal as="section" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Проблема"
          title="Вакансии есть. Приоритета нет."
          description="Радар показывает не вакансии, а компании, которым стоит написать первыми — с доказательствами и поводом для контакта."
        />
        <div className={hpStyles.problemGrid}>
          <article className={`${hpStyles.problemCard} ${hpStyles.revealCard}`}>
            <span className={hpStyles.problemIndex}>01</span>
            <h3>Все видят одно и то же</h3>
            <p>Открытые вакансии одновременно замечают десятки агентств — реакция на них не дает преимущества.</p>
          </article>
          <article className={`${hpStyles.problemCard} ${hpStyles.revealCard}`}>
            <span className={hpStyles.problemIndex}>02</span>
            <h3>Вакансия — ещё не лид</h3>
            <p>Активный найм не всегда означает готовность работать с агентством. Нужен контекст, а не список ролей.</p>
          </article>
          <article className={`${hpStyles.problemCard} ${hpStyles.revealCard}`}>
            <span className={hpStyles.problemIndex}>03</span>
            <h3>Контекст требует времени</h3>
            <p>Даты, динамику, источники и корректный контакт приходится собирать вручную — на это уходит час за компанией.</p>
          </article>
        </div>
      </ScrollReveal>

      {/* Live preview */}
      <ScrollReveal as="section" id="preview" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Пример результата"
          title="Так выглядит утренний радар"
          description={previewState.isLive
            ? "Задайте город и специализацию — справа появится тот самый список, что утром приходит в Telegram."
            : "Задайте город и специализацию. Сейчас можно оценить структуру карточек; актуальная выдача появится здесь после восстановления источника."}
        />

        <div className={hpStyles.previewGrid}>
          <SurfaceCard className={hpStyles.previewCardContainer}>
            <div className={hpStyles.previewCardHeading}>Параметры профиля</div>

            <form method="GET" action="/#preview" style={{ display: "grid", gap: "14px" }}>
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

              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                <button type="submit" className={ppStyles.primaryAction}>
                  Посмотреть компании
                </button>

                {hasPreview ? (
                  <Link href="/#preview" className={ppStyles.secondaryAction}>
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
                  {previewState.isLive
                    ? previewState.isPersonalized
                      ? "Радар для вашего профиля"
                      : "Как выглядит радар"
                    : "Демо радара"}
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

            {!previewState.isLive ? (
              <NoticeBox
                tone="neutral"
                title="Показываем демо-карточки"
                description="Актуальная выдача временно недоступна. Структура карточек, оценки и состав полей соответствуют реальному радару."
              />
            ) : null}

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
              {!previewState.isLive
                ? "Запустить актуальный радар"
                : previewState.items.length > 0
                  ? "Получать такой радар каждое утро"
                  : "Попробовать неделю"}
            </Link>
          </SurfaceCard>
        </div>
      </ScrollReveal>

      {/* How it works — the three-step flow */}
      <ScrollReveal as="section" className={hpStyles.scrollSection}>
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
            <p>3–7 компаний с причиной, доказательствами, контактом и следующим шагом — в Telegram.</p>
          </article>
        </div>
        <div className={hpStyles.stepsTrack} aria-hidden="true" />
      </ScrollReveal>

      {/* Signal anatomy — what a single lead card contains */}
      <ScrollReveal as="section" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Карточка лида"
          title="Почему компании стоит написать"
          description="Каждая рекомендация содержит факты, источники и конкретный следующий шаг — без выдуманных данных."
        />
        <p className={hpStyles.demoNote}>
          {previewState.isLive
            ? "Ниже — пример структуры карточки. Реальные компании, даты и источники приходят в радаре выше и в Telegram."
            : "Ниже — пример структуры карточки. В рабочем радаре компании, даты и источники берутся из актуальных открытых данных."}
        </p>
        <div className={hpStyles.signalLayout}>
          <div className={hpStyles.signalSide}>
            <span className={hpStyles.priorityChip}>Высокий приоритет</span>
            <h3 className={hpStyles.signalSideTitle}>Производственная компания</h3>
            <p className={hpStyles.signalSideSub}>Промышленность · Москва и область</p>
            <div className={hpStyles.bigScore}>87<small>/100</small></div>
            <div className={hpStyles.signalSideMeta}>
              <div className={hpStyles.signalSideMetaRow}><span>Уверенность</span><b>Подтверждено</b></div>
              <div className={hpStyles.signalSideMetaRow}><span>Источники</span><b>2 независимых</b></div>
              <div className={hpStyles.signalSideMetaRow}><span>Контакт</span><b>Найден</b></div>
            </div>
          </div>
          <div className={hpStyles.signalMain}>
            <div className={hpStyles.detailGrid}>
              <div className={hpStyles.detail}>
                <h3>Что изменилось</h3>
                <p>14 новых вакансий за 6 дней, включая редкую инженерную роль.</p>
              </div>
              <div className={hpStyles.detail}>
                <h3>Почему сейчас</h3>
                <p>Найм ускорился, а сложные роли повышают нагрузку на внутреннюю команду.</p>
              </div>
              <div className={`${hpStyles.detail} ${hpStyles.detailFull}`}>
                <h3>Следующий шаг</h3>
                <p>Проверить HR-форму на сайте компании и предложить помощь по инженерным ролям.</p>
              </div>
            </div>
            <p className={hpStyles.timelineTitle}>Хронология сигнала</p>
            <div className={hpStyles.timeline}>
              <div className={hpStyles.timelineItem}><time>15 июля</time><span>На карьерной странице появились 4 новые инженерные позиции</span></div>
              <div className={hpStyles.timelineItem}><time>12 июля</time><span>Количество открытых вакансий выросло с 7 до 16</span></div>
            </div>
            <div className={hpStyles.trustLine}>Компания, даты и факты подтверждаются открытыми источниками</div>
          </div>
        </div>
      </ScrollReveal>

      {/* Pricing — hierarchy: primary week plan, then secondary plans */}
      <ScrollReveal as="section" id="pricing" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Тарифы"
          title="Один радар — на неделю, месяц или квартал"
        />

        <div className={hpStyles.pricingGrid}>
          <SurfaceCard
            key={pilotPlan.code}
            className={`${hpStyles.primaryPlanCard} ${hpStyles.revealCard}`}
          >
            <span className={hpStyles.primaryPlanBadge}>Рекомендуем начать</span>
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
            </div>
            <p className={hpStyles.planDescription}>{pilotPlan.description}</p>
            <div className={hpStyles.planFeatureLine}>
              <b>Разовая оплата</b>
              <span>Без автопродления</span>
            </div>
            <Link
              href={buildCheckoutHref({ ...previewInput, planCode: pilotPlan.code })}
              className={`${ppStyles.primaryAction} ${hpStyles.planCta}`}
            >
              {pilotPlan.ctaLabel}
            </Link>
            <p className={hpStyles.billingNote}>После оплаты вы настраиваете профиль и подключаете Telegram.</p>
          </SurfaceCard>

          <div className={hpStyles.secondaryPlansRow}>
            {secondaryPlans.map((plan) => {
              const isQuarterly = plan.code === "quarterly";
              return (
                <SurfaceCard
                  key={plan.code}
                  className={`${hpStyles.secondaryPlanCard} ${hpStyles.revealCard}`}
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
                  <div className={hpStyles.planFeatureLine}>
                    <b>Подключение по заявке</b>
                    <span>Без автоматического списания</span>
                  </div>
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
          accent
          eyebrow="Перед запуском"
          title="Коротко о порядке"
        />
        {faqItems.map((item) => (
          <details key={item.question} className={`${hpStyles.faqCard} ${hpStyles.revealCard}`}>
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
        <h2 className={hpStyles.closingTitle}>Узнайте, кому стоит написать</h2>
        <p className={hpStyles.closingText}>
          Настройте профиль агентства, получите первый список компаний и проверьте качество нового канала клиентского спроса за 7 дней.
        </p>
        <div className={hpStyles.closingActions}>
          <Link href={checkoutHref} className={hpStyles.heroCta}>
            Активировать неделю — 2 990 ₽
          </Link>
          <a href="#preview" className={hpStyles.heroSecondaryCta}>Посмотреть пример</a>
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
  const previewSections = [
    {
      label: "Компания и контакты",
      value: contactPath || "Корпоративный контакт уточняется",
    },
    {
      label: "Релевантные вакансии",
      value: [vacanciesCaption, evidenceTitles.slice(0, 2).join(" · ")].filter(Boolean).join(" · "),
    },
    {
      label: "Сигналы",
      value: whyNow || "Активность найма подтверждена источниками",
    },
  ];
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
      {location ? (
        <div className={hpStyles.previewCardTopbar}>
          <span className={hpStyles.previewCardLoc} aria-label={`География: ${location}`}>{location}</span>
        </div>
      ) : null}

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

      <div className={hpStyles.previewEvidence} aria-label="Краткая информация о компании">
        {previewSections.map((section) => (
          <div key={section.label}>
            <span>{section.label}</span>
            <p>{section.value}</p>
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
