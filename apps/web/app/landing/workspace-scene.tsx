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
import { ArrowGlyph } from "./brand-glyphs";
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

export default function WorkspaceScene(props: WorkspaceProps) {
  return (
    <section
      id="scene-workspace"
      className={`${styles.scene} ${styles.lightScene} ${styles.workspaceScene} ${sceneStyles.section}`}
      aria-labelledby="workspace-title"
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
          <div className={sceneStyles.previewHeader} aria-label="Состояние интерактивного примера">
            <span>Живой пример</span>
            <strong>Приоритет компаний на сегодня</strong>
            <small>профиль можно менять</small>
          </div>
          <PreviewConfigurator previewInput={props.previewInput} hasPreview={props.hasPreview} />
          <div
            id="preview-results"
            className={`${styles.workspaceResults} ${sceneStyles.anchor} ${sceneStyles.results}`}
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
    <div className={`${styles.workspaceIntro} ${sceneStyles.intro}`}>
      <p className={styles.sceneLabel}>Проверьте на своей нише</p>
      <h2 id="workspace-title" className={styles.sceneHeading}>Настройте профиль — выдача обновится.</h2>
      <p className={styles.sceneLead}>
        Выберите специализацию и географию. Сначала покажем несколько компаний, которым есть смысл уделить внимание.
      </p>
    </div>
  );
}

function PreviewConfigurator(props: Pick<WorkspaceProps, "previewInput" | "hasPreview">) {
  return (
    <div id="preview-configurator" className={`${styles.workspaceControls} ${sceneStyles.anchor} ${sceneStyles.controls}`} data-preview-configurator>
      <div className={`${styles.presetStrip} ${sceneStyles.presets}`} aria-label="Готовые профили радара">
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

      <form method="GET" action="/#preview-results" className={`${styles.workspaceForm} ${sceneStyles.commandForm}`} data-preview-form aria-busy="false">
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
        {props.previewInput.includeKeywords ? <input type="hidden" name="includeKeywords" value={props.previewInput.includeKeywords} /> : null}
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
    const appliedProfile = [props.previewInput.specialization, props.previewInput.targetCity].filter(Boolean);
    const visibleItems = previewState.items.slice(0, 4);

    return (
      <div
        id={props.embedded ? undefined : "preview-results"}
        className={props.embedded ? undefined : `${styles.workspaceResults} ${sceneStyles.anchor} ${sceneStyles.results}`}
        data-preview-results={props.embedded ? undefined : true}
        data-preview-results-ready
      >
        <PreviewGeneratedEvent
          generated={previewState.isLive && previewState.isPersonalized}
          context={LANDING_ANALYTICS_CONTEXT.preview}
        />
        <div className={`${styles.workspaceResultsHeader} ${sceneStyles.resultsHeader}`}>
          <div>
            <span>КОМПАНИИ НА СЕГОДНЯ / {String(previewState.items.length).padStart(2, "0")}</span>
            <strong>{previewState.isPersonalized ? "Приоритет по вашему профилю" : "Пример сегодняшней выдачи"}</strong>
          </div>
          <span data-live={previewState.isLive || undefined}>
            {previewState.isLive ? "свежие данные" : "демо"}
          </span>
        </div>

        {!previewState.isLive ? (
          <p className={styles.workspaceDataNote}>
            <strong>Обезличенный пример.</strong> Названия и часть фактов изменены; логика приоритета и типы источников сохранены.
          </p>
        ) : null}

        {appliedProfile.length > 0 ? (
          <div className={styles.appliedProfile} aria-label="Применённый профиль">
            <span>Профиль</span><strong>{appliedProfile.join(" · ")}</strong>
          </div>
        ) : null}

        {previewState.items.length === 0 ? (
          <div className={styles.workspaceEmpty} role="status">
            <span>Пока нет точных совпадений.</span>
            <strong>Попробуйте расширить географию или уточнить специализацию.</strong>
          </div>
        ) : (
          <div>
            {previewState.isPersonalized && !previewState.hasExactMatches ? (
              <p className={styles.workspaceMatchNote}>Точных совпадений пока нет — показаны ближайшие по релевантности компании.</p>
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

        <div className={sceneStyles.footerRail}>
          <Link
            prefetch={false}
            href={props.checkoutHref}
            className={sceneStyles.checkout}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.preview}
          >
            {previewState.items.length > 0 ? "Запустить радар на 7 дней" : "Попробовать неделю"} <ArrowGlyph />
          </Link>
          <small>7 дней · без автопродления</small>
        </div>
      </div>
    );
  } catch {
    return <WorkspaceResultsFailure checkoutHref={props.checkoutHref} embedded={props.embedded} />;
  }
}

function WorkspaceResultsFailure({ checkoutHref, embedded }: { checkoutHref: string; embedded?: boolean }) {
  return (
    <div
      id={embedded ? undefined : "preview-results"}
      className={embedded ? undefined : `${styles.workspaceResults} ${sceneStyles.anchor} ${sceneStyles.results}`}
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
      <div className={sceneStyles.footerRail}>
        <Link
          prefetch={false}
          href={checkoutHref}
          className={sceneStyles.checkout}
          data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
          data-analytics-context={LANDING_ANALYTICS_CONTEXT.preview}
        >
          Попробовать 7 дней <ArrowGlyph />
        </Link>
        <small>7 дней · без автопродления</small>
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
