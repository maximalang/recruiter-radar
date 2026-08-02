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
import LandingHeader from "./landing-header";
import LandingHowItWorks from "./landing-how-it-works";
import LandingMethodology from "./landing-methodology";
import LandingPreviewInteractions from "./landing-preview-interactions";
import LandingPreviewPresets from "./landing-preview-presets";
import PreviewGeneratedEvent from "./preview-generated-event";
import ScrollReveal from "./scroll-reveal";
import YandexMetrika from "./yandex-metrika";
import { SiteFooter } from "./ui/site-footer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recruiter Radar — клиентские возможности для рекрутинговых агентств",
  description:
    "Evidence-first радар для рекрутинговых агентств: компании с актуальной потребностью в найме, проверяемые сигналы, приоритет и безопасный путь контакта.",
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
  // for the pilot CTA (which reads it synchronously) while the
  // actual digest DB query lives behind a <Suspense> boundary in <PreviewSection>
  // below. The home page is `force-dynamic`, so without the boundary the whole
  // server render blocked on getPublicSampleDigestState (a Postgres query) and
  // first-contentful-paint sat at ~2.5s — the "half the landing doesn't load"
  // symptom. Now hero + problem + how-it-works + quality + agency proof + FAQ
  // paint immediately and the live preview streams in.
  const previewInput = readPublicPreviewInput(resolvedSearchParams);
  const hasPreview = hasPublicPreviewInput(previewInput);
  const checkoutHref = buildCheckoutHref(previewInput);
  const paymentSetup = getPaymentProviderSetupState();
  const faqItems = buildFaqItems(paymentSetup.configured);
  const pilotPlan = PUBLIC_PLANS.find((p) => p.code === "pilot") ?? PUBLIC_PLANS[0];
  return (
    <PageFrame
      maxWidth="1240px"
      className={hpStyles.landingRoot}
      dataDeployAnchor="recruiter-radar-landing-v4"
    >
      <YandexMetrika />
      <LandingAnalytics />
      <LandingDetailsInteractions />
      <a href="#main-content" className={ppStyles.skipLink}>Перейти к содержанию</a>
      <LandingHeader previewHref="#preview-configurator" />

      <section
        id="main-content"
        className={hpStyles.heroSection}
        aria-label="Recruiter Radar"
      >
        <div className={hpStyles.heroContent}>
          <div className={hpStyles.heroCopy}>
            <div className={hpStyles.heroEyebrow}>
              Evidence-first радар для рекрутинговых агентств
            </div>
            <h1 className={hpStyles.heroTitle}>
              Находите компании, которым нужен подбор — до массового отклика агентств
            </h1>
            <p className={hpStyles.heroSubtitle}>
              Recruiter Radar анализирует изменения в найме, объединяет факты по компании и показывает, кому стоит написать сейчас — с датами, источниками и понятной причиной.
            </p>
            <div className={hpStyles.heroActions}>
              <a
                href="#preview-configurator"
                className={hpStyles.heroCta}
                data-analytics-event={LANDING_ANALYTICS_EVENT.previewStarted}
                data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroPrimary}
              >
                Проверить свою нишу
              </a>
              <a
                href="#opportunity-example"
                className={hpStyles.heroSecondaryCta}
                data-analytics-event={LANDING_ANALYTICS_EVENT.previewResultsClicked}
                data-analytics-context={LANDING_ANALYTICS_CONTEXT.heroSecondary}
              >
                Посмотреть пример
              </a>
            </div>
            <p className={hpStyles.heroFootnote}>
              Для руководителей и BD-команд агентств · без массовых рассылок и покупки личных контактов
            </p>
          </div>

          <article id="opportunity-example" className={hpStyles.heroProduct} aria-labelledby="opportunity-title">
            <div className={hpStyles.heroProductTopbar}>
              <span className={hpStyles.heroProductLabel}>Обезличенный пример</span>
              <span className={hpStyles.heroProductDate}>Обновлено <time dateTime="2026-07-31">31 июля 2026</time></span>
            </div>
            <div className={hpStyles.heroCompanyRow}>
              <div>
                <h2 id="opportunity-title" className={hpStyles.heroCompanyName}>Промышленная группа</h2>
                <div className={hpStyles.heroCompanyMeta}>Москва и область · инженерный найм</div>
              </div>
              <div className={hpStyles.heroScore}><span>Radar Score</span><strong>87</strong><small>/100</small></div>
            </div>
            <div className={hpStyles.heroSignalList} aria-label="Обнаруженные сигналы">
              <div><time dateTime="2026-07-31">31 июл</time><p><strong>14 новых вакансий за 6 дней</strong><span>Темп найма выше обычного уровня компании</span></p></div>
              <div><time dateTime="2026-07-29">29 июл</time><p><strong>Открыта редкая инженерная роль</strong><span>Инженер-конструктор опубликован повторно</span></p></div>
              <div><time dateTime="2026-07-28">28 июл</time><p><strong>Обновлена карьерная страница</strong><span>Появился прямой корпоративный путь к HR</span></p></div>
            </div>
            <div className={hpStyles.heroRecommendation}>
              <div>
                <span>Почему сейчас</span>
                <p>Найм ускорился, а сложная роль остаётся открытой. У агентства есть конкретный повод предложить помощь.</p>
              </div>
              <div>
                <span>Угол первого сообщения</span>
                <p>Предложить точечный подбор по инженерным ролям с опорой на свежую динамику вакансий.</p>
              </div>
            </div>
            <div className={hpStyles.heroSources}>
              <span>Источники</span>
              <strong>hh.ru</strong>
              <strong>Карьерная страница компании</strong>
              <em>Уровень доверия A</em>
            </div>
          </article>
        </div>
      </section>

      <ScrollReveal as="section" className={`${hpStyles.scrollSection} ${hpStyles.problemSection}`}>
        <div className={hpStyles.problemLayout}>
          <SectionIntro
            accent
            eyebrow="Почему обычный поиск не работает"
            title="База показывает кому. Радар — почему сейчас."
            description="Список контактов не объясняет момент для обращения. Recruiter Radar начинает с изменений в найме и только потом формирует приоритет."
          />
          <ol className={hpStyles.problemList}>
            <li className={hpStyles.problemRow}>
              <span className={hpStyles.problemIndex}>01</span>
              <div><h3>Слишком рано или слишком поздно</h3><p>Одна вакансия не показывает, когда потребность стала системной и кому уже предложили помощь конкуренты.</p></div>
            </li>
            <li className={hpStyles.problemRow}>
              <span className={hpStyles.problemIndex}>02</span>
              <div><h3>Нет причины для персонального выхода</h3><p>Без дат, динамики и контекста первое сообщение остаётся общим и легко теряется среди массового outreach.</p></div>
            </li>
            <li className={hpStyles.problemRow}>
              <span className={hpStyles.problemIndex}>03</span>
              <div><h3>Ручная проверка съедает день</h3><p>Вакансии, карьерные страницы и корпоративные события приходится сопоставлять вручную, пока сигнал теряет свежесть.</p></div>
            </li>
          </ol>
        </div>
      </ScrollReveal>

      <ScrollReveal as="section" id="how-it-works" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Как работает радар"
          title="От открытого сигнала — к понятному следующему шагу"
          description="Система не выдаёт непрозрачный список. Каждый этап оставляет факты, которые можно проверить."
        />
        <LandingHowItWorks />
      </ScrollReveal>

      <section id="preview" data-section="preview" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Продукт в работе"
          title="Соберите выдачу под специализацию агентства"
          description="Укажите нишу и географию. Радар пересчитает приоритет и покажет факты, ограничения и безопасный путь контакта."
        />
        <Suspense fallback={<PreviewSkeleton />}>
          <PreviewSection previewInput={previewInput} hasPreview={hasPreview} checkoutHref={checkoutHref} />
        </Suspense>
        <LandingPreviewInteractions />
      </section>

      <ScrollReveal as="section" id="quality" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Evidence-first"
          title="Приоритет можно проверить, а не принять на веру"
          description="Рядом с оценкой остаются факты, даты, источники и ограничения. Неподтверждённый контекст не становится лидом."
        />
        <div className={hpStyles.qualityGrid}>
          <LandingMethodology />
          <aside className={hpStyles.evidenceContract} aria-label="Что получает команда">
            <span className={hpStyles.evidenceContractEyebrow}>В каждой рекомендации</span>
            <h3>Достаточно контекста для решения</h3>
            <dl>
              <div><dt>Факт</dt><dd>Что изменилось в найме и когда это произошло.</dd></div>
              <div><dt>Обоснование</dt><dd>Почему сигнал подходит профилю агентства и насколько он свежий.</dd></div>
              <div><dt>Действие</dt><dd>Какой корпоративный путь контакта доступен и с какого угла начать.</dd></div>
            </dl>
            <p>Recruiter Radar готовит решение, но не отправляет сообщения автоматически.</p>
          </aside>
        </div>
      </ScrollReveal>

      <ScrollReveal as="section" id="for-agencies" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Для рекрутинговых агентств"
          title="Один рабочий контекст для руководителя, BD и рекрутера"
          description="Радар помогает команде договориться, какие компании действительно заслуживают внимания сегодня."
        />
        <div className={hpStyles.agencyGrid}>
          <div className={hpStyles.agencyRoles}>
            <div><span>Руководителю</span><p>Видеть, почему компания в приоритете и на каких фактах строится решение.</p></div>
            <div><span>BD-команде</span><p>Начинать день с короткого списка и конкретных поводов для первого сообщения.</p></div>
            <div><span>Рекрутеру</span><p>Подключаться к диалогу с контекстом по ролям, динамике найма и ограничениям.</p></div>
          </div>
          <div className={hpStyles.agencyOutcome}>
            <span>Практический результат</span>
            <h3>Меньше ручного исследования. Точнее выбор компаний. Своевременнее выход.</h3>
            <p>Команда сохраняет контроль над обращением, а радар отвечает за поиск, проверку и объяснение приоритета.</p>
          </div>
        </div>
      </ScrollReveal>

      <ScrollReveal as="section" id="faq" className={hpStyles.scrollSection}>
        <SectionIntro
          accent
          eyebrow="Вопросы"
          title="Что важно знать до запуска"
          description="Коротко о данных, контактах, доставке и следующем шаге."
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

      <section className={hpStyles.closingBand} data-final-cta="true">
        <span className={hpStyles.closingEyebrow}>Пилот Recruiter Radar</span>
        <h2 className={hpStyles.closingTitle}>Проверьте радар на своей нише за 7 дней</h2>
        <p className={hpStyles.closingText}>
          Настройте профиль, получите первую выдачу и оцените качество рекомендаций на реальных задачах агентства.
        </p>
        <p className={hpStyles.closingTerms}>
          {pilotPlan.price} · {pilotPlan.cadence} · {paymentSetup.configured ? "без автопродления" : "заявка без списания, профиль сохранится"}
        </p>
        <Link
          href={checkoutHref}
          className={hpStyles.heroCta}
          data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
          data-analytics-context={LANDING_ANALYTICS_CONTEXT.closing}
        >
          {paymentSetup.configured ? `Активировать пилот — ${pilotPlan.price}` : "Оставить заявку на пилот"}
        </Link>
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
 * pre-computed synchronously in HomePage and passed in (the closing CTA also
 * reads `previewInput`, so we don't recompute it here).
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
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
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
