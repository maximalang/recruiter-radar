import Link from "next/link";

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
import ConversionPanel from "./conversion-panel";
import { ArrowGlyph } from "./brand-glyphs";
import WorkspaceLead from "./workspace-lead";
import styles from "./landing.module.css";

const PREVIEW_PRESETS = [
  { label: "Инженерный подбор · Москва", specialization: "инженерный подбор", targetCity: "Москва" },
  { label: "IT-подбор · удалённо", specialization: "IT-подбор", targetCity: "удалённо" },
  { label: "Коммерческие роли · Петербург", specialization: "коммерческие роли", targetCity: "Санкт-Петербург" },
] as const;

export default async function WorkspaceScene(props: {
  previewInput: PublicPreviewInput;
  hasPreview: boolean;
  checkoutHref: string;
  paymentConfigured: boolean;
  faqItems: ReadonlyArray<{ question: string; answer: string }>;
}) {
  const previewState = await getPublicSampleDigestState(props.previewInput);
  const appliedProfile = [props.previewInput.specialization, props.previewInput.targetCity].filter(Boolean);

  return (
    <section id="scene-workspace" className={`${styles.scene} ${styles.darkScene} ${styles.workspaceScene}`} aria-labelledby="workspace-title">
      <div className={styles.workspaceLayout} data-preview-section-content>
        <PreviewGeneratedEvent
          generated={previewState.isLive && previewState.isPersonalized}
          context={LANDING_ANALYTICS_CONTEXT.preview}
        />
        <LandingPreviewInteractions />
        <div className={styles.workspaceIntro}>
          <p className={styles.sceneLabel}>05 — Рабочий радар</p>
          <h2 id="workspace-title" className={styles.sceneHeading}>
            Один сигнал становится <em>частью рабочего приоритета.</em>
          </h2>
          <p className={styles.sceneLead}>
            Настройте специализацию и географию. Существующая логика preview пересчитает порядок компаний и покажет доказательства.
          </p>
        </div>

        <div id="preview-configurator" className={styles.workspaceControls}>
          <div className={styles.presetStrip} aria-label="Готовые профили радара">
            <span>Профиль / быстрый старт</span>
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

        <div id="preview-results" className={styles.workspaceResults} data-preview-results>
          <div className={styles.workspaceResultsHeader}>
            <div>
              <span>LIVE PREVIEW / {String(previewState.items.length).padStart(2, "0")}</span>
              <strong>{previewState.isPersonalized ? "Радар для вашего профиля" : "Утренняя выдача"}</strong>
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
                : "Выберите профиль: порядок и оценка изменятся по тем же правилам, что в live-выдаче."}
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
            className={styles.workspaceCheckout}
            data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
            data-analytics-context={LANDING_ANALYTICS_CONTEXT.preview}
          >
            {previewState.items.length > 0 ? "Получать такой радар каждое утро" : "Попробовать неделю"} <ArrowGlyph />
          </Link>
        </div>

        <ConversionPanel
          previewInput={props.previewInput}
          paymentConfigured={props.paymentConfigured}
          faqItems={props.faqItems}
        />
      </div>
    </section>
  );
}

export function WorkspaceSkeleton() {
  return (
    <section className={`${styles.scene} ${styles.darkScene} ${styles.workspaceScene}`} aria-labelledby="workspace-loading-title">
      <div className={styles.workspaceLayout} data-preview-section-content aria-busy="true">
        <div className={styles.workspaceIntro}>
          <p className={styles.sceneLabel}>05 — Рабочий радар</p>
          <h2 id="workspace-loading-title" className={styles.sceneHeading}>Один сигнал становится частью рабочего приоритета.</h2>
        </div>
        <div className={styles.workspaceSkeletonLine} />
        <div className={styles.workspaceSkeleton}>
          <span /><span /><span />
        </div>
      </div>
    </section>
  );
}
