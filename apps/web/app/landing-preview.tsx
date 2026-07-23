import Link from "next/link";

import {
  PUBLIC_PREVIEW_FIELD_LIMITS,
  buildPublicPreviewHref,
  getPublicSampleDigestState,
  type PublicPreviewInput,
} from "../lib/publicProduct";
import { formatScorePoints, scorePercent, scoreTone } from "../lib/scoring/score-display";
import { formatLawfulContactPath, deriveWhyNow } from "../lib/leads-data";
import { formatVacanciesCount } from "../lib/format/plural";
import { NoticeBox, SectionIntro, StatusBadge, SurfaceCard } from "./ui/page-primitives";
import ppStyles from "./ui/page-primitives.module.css";
import {
  buildPreviewEvidenceItems,
  cleanEmployerName,
  formatLocationCaption,
  formatVacancyFreshness,
  pickEvidenceTitles,
} from "./home-page-components";
import hpStyles from "./home-page-components.module.css";
import ScrollReveal from "./scroll-reveal";
import { LandingStageEvent } from "./landing-analytics";

const VISIBLE_PREVIEW_ITEMS = 2;
const PREVIEW_PRESETS = [
  { label: "Инженерный подбор · Москва", specialization: "инженерный подбор", targetCity: "Москва" },
  { label: "IT-подбор · удалённо", specialization: "IT-подбор", targetCity: "удалённо" },
  { label: "Коммерческие роли · Петербург", specialization: "коммерческие роли", targetCity: "Санкт-Петербург" },
] as const;

type HomePreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

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
export async function LandingPreviewSection(props: {
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
    <ScrollReveal as="section" id="preview" className={hpStyles.scrollSection}>
      {hasPreview ? <LandingStageEvent name="preview_generated" context="preview" /> : null}
      <SectionIntro
        accent
        eyebrow="Рабочий радар"
        title="Проверьте радар на своём профиле"
        description="Укажите специализацию и географию. Радар пересчитает приоритеты и покажет, почему каждая компания поднялась в выдаче."
      />

      <div className={hpStyles.previewWorkspace}>
        <SurfaceCard
          className={hpStyles.previewConfigurator}
          padding="var(--preview-surface-padding)"
        >
          <div id="preview-configurator" className={hpStyles.previewConfiguratorLead}>
            <h3 className={hpStyles.previewCardHeading}>Соберите свою выдачу</h3>
            <p>Двух полей достаточно для первого пересчёта. Можно начать с готового профиля.</p>
            <div className={hpStyles.previewPresets} aria-label="Готовые профили радара">
              {PREVIEW_PRESETS.map((preset) => {
                const isActive = previewInput.specialization === preset.specialization && previewInput.targetCity === preset.targetCity;
                return (
                  <Link
                    key={preset.label}
                    href={buildPublicPreviewHref({ ...preset, dailyDigestLimit: previewInput.dailyDigestLimit })}
                    aria-current={isActive ? "true" : undefined}
                    data-preview-preset="true"
                    data-active={isActive ? "true" : undefined}
                    data-landing-events="preview_started"
                    data-landing-event-context="preset"
                  >
                    {preset.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <form
            method="GET"
            action="/#preview-results"
            className={hpStyles.previewForm}
            data-preview-form="true"
            data-landing-events="preview_started"
            data-landing-event-context="form"
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
              <button type="submit" className={ppStyles.primaryAction} data-loading-label="Радар анализирует сигналы">
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

        <SurfaceCard
          className={`${hpStyles.previewCardContainer} ${hpStyles.previewResults}`}
          padding="var(--preview-surface-padding)"
        >
          <div id="preview-results" className={hpStyles.previewHeaderRow} data-preview-results="true">
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
              <span role="status" aria-live="polite">Профиль применён</span>
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
                    revealIndex={index}
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
                      {hiddenPreviewItems.map((item, index) => (
                        <PreviewDigestCard
                          key={`${item.org_id}-${item.rank}`}
                          item={item}
                          defaultOpen={false}
                          revealIndex={index + VISIBLE_PREVIEW_ITEMS}
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
            data-landing-events="preview_checkout_clicked"
            data-landing-event-context="preview"
          >
            {previewState.items.length > 0
              ? "Получать такой радар каждое утро"
              : "Попробовать неделю"}
          </Link>
        </SurfaceCard>
      </div>
    </ScrollReveal>
  );
}

/**
 * Suspense fallback for <LandingPreviewSection>. Reserves the same workspace footprint
 * and shows the eyebrow/title so the block is visibly
 * "there" (not missing) while the digest query streams in — the section heading
 * is what the user's "half the landing doesn't load" complaint was about. The
 * shimmer bars stay subtle (premium, not a spinner) and the form is intentionally
 * omitted from the skeleton so the interactive inputs don't render twice.
 */
export function LandingPreviewSkeleton() {
  return (
    <ScrollReveal as="section" id="preview" className={hpStyles.scrollSection}>
      <SectionIntro
        accent
        eyebrow="Рабочий радар"
        title="Проверьте радар на своём профиле"
        description="Укажите специализацию и географию — радар покажет компании, которые подходят именно вашему агентству."
      />
      <div className={hpStyles.previewWorkspace}>
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
          <noscript>
            <div className={hpStyles.previewNoScript}>
              <span className={hpStyles.previewNoScriptEyebrow}>Обезличенный пример</span>
              <strong>Пример лида доступен без анимации</strong>
              <p>Сигнал найма подтверждён двумя источниками</p>
              <dl>
                <div>
                  <dt>Почему сейчас</dt>
                  <dd>Компания расширяет команду и недавно обновила вакансии.</dd>
                </div>
                <div>
                  <dt>Безопасный следующий шаг</dt>
                  <dd>Проверить корпоративную форму контакта — без автоматической отправки.</dd>
                </div>
              </dl>
            </div>
          </noscript>
        </SurfaceCard>
      </div>
    </ScrollReveal>
  );
}

function PreviewDigestCard(props: {
  item: HomePreviewItem;
  defaultOpen: boolean;
  revealIndex: number;
}) {
  const { item, defaultOpen, revealIndex } = props;
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
          data-animated-details
      data-tone={tone}
      data-result-index={revealIndex}
      name="preview-leads"
      open={defaultOpen}
      style={{ "--result-delay": `${Math.min(revealIndex, 5) * 70}ms` } as React.CSSProperties}
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
          <span className={hpStyles.previewStrengthFill} data-tone={tone} style={{ "--meter-value": `${pct}%` } as React.CSSProperties} />
        </div>

        <div className={hpStyles.previewLeadEvidence}>
          <div><span>Что изменилось</span><p>{detailWhat}</p></div>
          <div><span>Почему сейчас</span><p>{detailMoment}</p></div>
          <div><span>Контакт</span><p>{detailContact}</p></div>
        </div>

        <div className={hpStyles.previewLeadMeters} aria-label="Оценка рекомендации">
          <LeadMeter label="Соответствие профилю" value={hasRelevance ? fitPct : 0} valueLabel={hasRelevance ? fitLabel : "После настройки"} />
          <LeadMeter label="Сила сигнала" value={pct} valueLabel={strengthLabel} />
          <LeadMeter label="Актуальность" value={freshness ? 88 : 30} valueLabel={freshnessLabel} />
          <LeadMeter label="Доступность контакта" value={reachabilityPct} valueLabel={reachabilityLabel} />
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

function LeadMeter(props: { label: string; value: number; valueLabel: string }) {
  return (
    <div className={hpStyles.previewLeadMeter}>
      <span>{props.label}</span>
      <span className={hpStyles.previewLeadMeterTrack} aria-hidden="true"><span style={{ "--meter-value": `${props.value}%` } as React.CSSProperties} /></span>
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
