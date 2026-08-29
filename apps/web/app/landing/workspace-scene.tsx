import Link from "next/link";
import { Suspense } from "react";

import {
  PUBLIC_PREVIEW_FIELD_LIMITS,
  buildPublicPreviewHref,
  getPublicSampleDigestState,
  type PublicPreviewInput,
} from "../../lib/publicProduct";
import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../../lib/landing-analytics-contract";
import LandingPreviewInteractions from "../landing-preview-interactions";
import PreviewGeneratedEvent from "../preview-generated-event";
import styles from "./landing.module.css";
import sceneStyles from "./workspace-scene.module.css";
import WorkspaceLead from "./workspace-lead";
import WorkspaceLeadList from "./workspace-lead-list";

const PREVIEW_PRESETS = [
  { label: "Инженерный подбор · Москва", specialization: "инженерный подбор", targetCity: "Москва" },
  { label: "IT-подбор · удалённо", specialization: "IT-подбор", targetCity: "удалённо" },
  { label: "Коммерческие роли · Петербург", specialization: "коммерческие роли", targetCity: "Санкт-Петербург" },
] as const;

type WorkspaceProps = {
  previewInput: PublicPreviewInput;
  hasPreview: boolean;
  checkoutHref: string;
};

type PreviewState = Awaited<ReturnType<typeof getPublicSampleDigestState>>;

export default function WorkspaceScene(props: WorkspaceProps) {
  return (
    <section
      id="scene-workspace"
      className={`${styles.scene} ${styles.lightScene} ${styles.workspaceScene} ${sceneStyles.section}`}
      aria-labelledby="workspace-title"
      aria-label="Интерактивный пример"
      data-header-tone="light"
      data-motion-reveal="section"
      data-preview-layout="marketing-demo"
    >
      <div className={styles.workspaceLayout} data-preview-section-content>
        <LandingPreviewInteractions />
        <WorkspaceIntro />
        <div
          className={sceneStyles.productFrame}
          data-product-preview="live-radar"
          data-preview-editorial="true"
        >
          <div className={sceneStyles.previewHeader} data-preview-rail aria-hidden="true">
            <span>Recruiter Radar</span>
            <small>ПРИМЕР</small>
          </div>
          <PreviewConfigurator previewInput={props.previewInput} hasPreview={props.hasPreview} />
          <div
            id="preview-results"
            className={`${styles.workspaceResults} ${sceneStyles.results}`}
            data-preview-results
            data-preview-results-skeleton
          >
            <Suspense fallback={<WorkspaceResultsSkeleton />}>
              <WorkspaceResults
                previewInput={props.previewInput}
                checkoutHref={props.checkoutHref}
                embedded
              />
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceIntro() {
  return (
    <header className={`${styles.workspaceIntro} ${sceneStyles.intro}`}>
      <div>
        <p className={styles.sceneLabel}>Интерактивный пример · Проверьте на своей нише</p>
        <h2 id="workspace-title" className={styles.sceneHeading}>Так выглядит ваша рабочая выдача.</h2>
      </div>
      <p className={styles.sceneLead}>
        По каждой компании: повод для контакта, подтверждающие факты, оценка уверенности и следующий шаг. Задайте нишу и географию — список перестроится под ваш профиль.
      </p>
    </header>
  );
}

function PreviewConfigurator(props: Pick<WorkspaceProps, "previewInput" | "hasPreview">) {
  return (
    <div
      id="preview-configurator"
      className={`${styles.workspaceControls} ${sceneStyles.controls}`}
      data-preview-configurator
    >
      <div className={`${styles.presetStrip} ${sceneStyles.presetStrip}`} aria-label="Готовые профили радара">
        <span>Готовые профили</span>
        {PREVIEW_PRESETS.map((preset) => {
          const selected = props.previewInput.specialization === preset.specialization
            && props.previewInput.targetCity === preset.targetCity;
          return (
            <Link
              key={preset.label}
              href={buildPublicPreviewHref({ ...preset, dailyDigestLimit: props.previewInput.dailyDigestLimit })}
              data-preview-preset
              data-selected={selected || undefined}
              aria-current={selected ? "true" : undefined}
            >
              {preset.label}
            </Link>
          );
        })}
      </div>

      <form
        method="GET"
        action="/#preview-results"
        className={`${styles.workspaceForm} ${sceneStyles.workspaceForm}`}
        data-preview-form
        aria-busy="false"
      >
        <label htmlFor="specialization">
          <span>Специализация</span>
          <input
            id="specialization"
            name="specialization"
            defaultValue={props.previewInput.specialization}
            maxLength={PUBLIC_PREVIEW_FIELD_LIMITS.specialization}
            placeholder="Например, инженерный подбор"
          />
        </label>
        <label htmlFor="targetCity">
          <span>География</span>
          <input
            id="targetCity"
            name="targetCity"
            defaultValue={props.previewInput.targetCity}
            maxLength={PUBLIC_PREVIEW_FIELD_LIMITS.targetCity}
            placeholder="Москва / удалённо"
          />
        </label>
        <label htmlFor="includeKeywords">
          <span>Кого ищете / сигналы</span>
          <input
            id="includeKeywords"
            name="includeKeywords"
            defaultValue={props.previewInput.includeKeywords}
            maxLength={PUBLIC_PREVIEW_FIELD_LIMITS.keywords}
            placeholder="конструктор, производство, разработка"
          />
        </label>
        {props.previewInput.excludeKeywords ? <input type="hidden" name="excludeKeywords" value={props.previewInput.excludeKeywords} /> : null}
        <input type="hidden" name="dailyDigestLimit" value={props.previewInput.dailyDigestLimit} />
        <button type="submit" data-preview-submit>
          <span data-preview-submit-label>Показать компании →</span>
          <span data-preview-submit-status hidden>Ищем свежие сигналы…</span>
        </button>
        {props.hasPreview ? <Link href="/#scene-workspace">Сбросить</Link> : null}
      </form>
    </div>
  );
}

export async function WorkspaceResults(props: Pick<WorkspaceProps, "previewInput" | "checkoutHref"> & { embedded?: boolean }) {
  try {
    const previewState = await getPublicSampleDigestState(props.previewInput);
    return (
      <WorkspaceResultsContent
        previewInput={props.previewInput}
        checkoutHref={props.checkoutHref}
        embedded={props.embedded}
        previewState={previewState}
      />
    );
  } catch {
    return <WorkspaceResultsFailure checkoutHref={props.checkoutHref} embedded={props.embedded} />;
  }
}

function WorkspaceResultsContent(
  props: Pick<WorkspaceProps, "previewInput" | "checkoutHref"> & { embedded?: boolean; previewState: PreviewState },
) {
  const previewState = props.previewState;
  const appliedProfile = [
    props.previewInput.specialization,
    props.previewInput.targetCity,
    props.previewInput.includeKeywords,
  ].filter(Boolean);
  const visibleItems = previewState.items.slice(0, 5);
  const statusLabel = previewState.isPersonalized
    ? `Выдача по вашему профилю · ${previewState.isLive ? "свежие данные" : "демо"}`
    : "Пример выдачи · демо-сценарий от 12 мая";

  return (
    <div
      id={props.embedded ? undefined : "preview-results"}
      className={props.embedded ? undefined : `${styles.workspaceResults} ${sceneStyles.results}`}
      data-preview-results={props.embedded ? undefined : true}
      data-preview-results-ready
    >
      <PreviewGeneratedEvent
        generated={previewState.isLive && previewState.isPersonalized}
        context={LANDING_ANALYTICS_CONTEXT.preview}
      />
      <div className={`${styles.workspaceResultsHeader} ${sceneStyles.resultsHeader}`}>
        <div>
          <strong>{statusLabel}</strong>
          {!previewState.isLive ? (
            <small className={sceneStyles.demoDisclosure}>
              <strong>Обезличенный пример.</strong> Названия и часть фактов изменены; логика приоритета и типы источников сохранены.
            </small>
          ) : null}
        </div>
        <span data-live={previewState.isLive || undefined}>{previewState.items.length} компаний</span>
      </div>

      {props.previewState.isPersonalized && appliedProfile.length > 0 ? (
        <div className={`${styles.appliedProfile} ${sceneStyles.appliedProfile}`} aria-label="Применённый профиль" data-applied-profile>
          <span>Применено</span>
          {appliedProfile.map((item) => <strong key={item}>{item}</strong>)}
        </div>
      ) : null}

      {previewState.items.length === 0 ? (
        <div className={styles.workspaceEmpty} role="status">
          <span>Сегодня по этому профилю ничего не найдено.</span>
          <strong>Измените специализацию или географию.</strong>
        </div>
      ) : (
        <div>
          {previewState.isPersonalized && !previewState.hasExactMatches ? (
            <p className={styles.workspaceMatchNote}>Точного совпадения не нашлось — показываем ближайшие компании по вашему профилю.</p>
          ) : null}
          <WorkspaceLeadList>
            {visibleItems.map((item, index) => (
              <WorkspaceLead
                key={`${item.org_id}-${item.rank}`}
                item={item}
                defaultOpen={index === 0}
              />
            ))}
          </WorkspaceLeadList>
        </div>
      )}

      <div className={sceneStyles.productFooter}>
        <Link
          className={sceneStyles.checkout}
          prefetch={false}
          href={props.checkoutHref}
          data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
          data-analytics-context={LANDING_ANALYTICS_CONTEXT.preview}
        >
          {previewState.items.length > 0 ? "Запустить радар на 7 дней →" : "Попробовать неделю →"}
        </Link>
        <span>7 дней · без автопродления</span>
      </div>
    </div>
  );
}

function WorkspaceResultsFailure({ checkoutHref, embedded }: { checkoutHref: string; embedded?: boolean }) {
  return (
    <div
      id={embedded ? undefined : "preview-results"}
      className={embedded ? undefined : `${styles.workspaceResults} ${sceneStyles.results}`}
      data-preview-results={embedded ? undefined : true}
      data-preview-results-ready
      role="status"
    >
      <div className={`${styles.workspaceResultsHeader} ${sceneStyles.resultsHeader}`}>
        <div><span>ПРИМЕР НЕДОСТУПЕН</span><strong>Не удалось обновить пример.</strong></div>
        <span>можно повторить</span>
      </div>
      <div className={styles.workspaceEmpty}>
        <span>Попробуйте ещё раз.</span>
        <strong>Тарифы и ответы на вопросы доступны ниже.</strong>
      </div>
      <div className={sceneStyles.productFooter}>
        <Link
          className={sceneStyles.checkout}
          prefetch={false}
          href={checkoutHref}
          data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
          data-analytics-context={LANDING_ANALYTICS_CONTEXT.preview}
        >
          Попробовать 7 дней →
        </Link>
        <span>7 дней · без автопродления</span>
      </div>
    </div>
  );
}

export function WorkspaceResultsSkeleton() {
  return (
    <div data-preview-results-skeleton aria-busy="true" aria-label="Результаты примера загружаются">
      <div className={styles.workspaceSkeleton}>
        <span /><span /><span />
      </div>
    </div>
  );
}
