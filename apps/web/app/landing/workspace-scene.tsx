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
    >
      <div className={styles.workspaceLayout} data-preview-section-content>
        <LandingPreviewInteractions />
        <WorkspaceIntro />
        <div className={styles.workspaceProductFrame}>
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
    <div className={styles.workspaceIntro}>
      <p className={styles.sceneLabel}>03 — Интерактивный пример</p>
      <h2 id="workspace-title" className={styles.sceneHeading}>
        Не обещание продукта, а <em>рабочий пример.</em>
      </h2>
      <p className={styles.sceneLead}>
        Укажите специализацию и географию. Серверный пример пересчитает порядок компаний и покажет факты, оценку и безопасный следующий шаг.
      </p>
    </div>
  );
}

function PreviewConfigurator(props: Pick<WorkspaceProps, "previewInput" | "hasPreview">) {
  return (
    <div id="preview-configurator" className={`${styles.workspaceControls} ${sceneStyles.anchor}`}>
      <div className={styles.presetStrip} aria-label="Готовые профили радара">
        <span>Быстрый старт</span>
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

      <form method="GET" action="/#preview-results" className={styles.workspaceForm} data-preview-form aria-busy="false">
        <label htmlFor="specialization">
          <span>Специализация</span>
          <input
            id="specialization"
            name="specialization"
            defaultValue={props.previewInput.specialization}
            maxLength={PUBLIC_PREVIEW_FIELD_LIMITS.specialization}
            placeholder="Инженерный подбор"
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
          <span data-preview-submit-label>Пересчитать радар</span>
          <span data-preview-submit-status hidden>Радар анализирует сигналы…</span>
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
        <div className={styles.workspaceResultsHeader}>
          <div>
            <span>ПРИМЕР / {String(previewState.items.length).padStart(2, "0")}</span>
            <strong>{previewState.isPersonalized ? "Радар для вашего профиля" : "Пример утренней выдачи"}</strong>
          </div>
          <span data-live={previewState.isLive || undefined}>
            {previewState.isLive ? "актуальные данные" : "примерные данные"}
          </span>
        </div>

        {!previewState.isLive ? (
          <p className={styles.workspaceDataNote}>
            <strong>Обезличенный набор.</strong>{" "}
            {previewState.isPersonalized
              ? "Приоритеты реально пересчитаны по профилю; названия и факты остаются примерными."
              : "Выберите профиль: порядок и оценка изменятся по тем же правилам, что в рабочей выдаче."}
          </p>
        ) : null}

        {appliedProfile.length > 0 ? (
          <div className={styles.appliedProfile} aria-label="Применённый профиль">
            <span>Применено</span>{appliedProfile.map((value) => <strong key={value}>{value}</strong>)}
          </div>
        ) : null}

        {previewState.items.length === 0 ? (
          <div className={styles.workspaceEmpty} role="status">
            <span>00 / Нет совпадений</span>
            <strong>Расширьте географию или уточните специализацию.</strong>
          </div>
        ) : (
          <div className={styles.workspaceLeadList}>
            {previewState.isPersonalized && !previewState.hasExactMatches ? (
              <p className={styles.workspaceMatchNote}>Точных совпадений пока нет — показаны ближайшие по релевантности.</p>
            ) : null}
            {previewState.items.slice(0, 5).map((item, index) => (
              <WorkspaceLead key={`${item.org_id}-${item.rank}`} item={item} defaultOpen={index === 0} />
            ))}
          </div>
        )}

        <Link
          href={props.checkoutHref}
          className={`${styles.workspaceCheckout} ${sceneStyles.checkout}`}
          data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
          data-analytics-context={LANDING_ANALYTICS_CONTEXT.preview}
        >
          {previewState.items.length > 0 ? "Получать такой радар каждое утро" : "Попробовать неделю"} <ArrowGlyph />
        </Link>
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
      <div className={styles.workspaceResultsHeader}>
        <div><span>ПРИМЕР / НЕДОСТУПЕН</span><strong>Оболочка продукта работает независимо от данных.</strong></div>
        <span>можно повторить</span>
      </div>
      <div className={styles.workspaceEmpty}>
        <span>Временная ошибка загрузки</span>
        <strong>Измените профиль или повторите запрос. Тарифы, FAQ и следующий шаг доступны ниже.</strong>
      </div>
      <Link
        href={checkoutHref}
        className={`${styles.workspaceCheckout} ${sceneStyles.checkout}`}
        data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
        data-analytics-context={LANDING_ANALYTICS_CONTEXT.preview}
      >
        Оставить заявку на неделю <ArrowGlyph />
      </Link>
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
