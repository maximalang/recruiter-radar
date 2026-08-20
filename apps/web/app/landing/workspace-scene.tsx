import { Input } from "@recruiter-radar/ui";

import { DEFAULT_LANDING_DEMO_STORY } from "../../lib/landing-demo";
import type { PublicPreviewInput, PublicPreviewItem } from "../../lib/publicProduct";
import { LandingTrackedSubmit } from "./landing-analytics";
import { WorkspaceLeadList } from "./workspace-lead-list";
import landingStyles from "./landing.module.css";
import sceneStyles from "./workspace-scene.module.css";

export type PreviewPreset = {
  id: string;
  label: string;
  specialization: string;
  targetCity: string;
  includeKeywords: string;
  excludeKeywords: string;
  dailyDigestLimit: number;
};

type WorkspaceSceneProps = {
  previewInput: PublicPreviewInput;
  previewState: {
    isLive: boolean;
    isPersonalized: boolean;
    hasExactMatches: boolean;
    items: PublicPreviewItem[];
  };
  previewPresets: PreviewPreset[];
  previewHref: string;
  checkoutHref: string;
  canCheckout: boolean;
  paymentConfigured: boolean;
};

function WorkspaceIntro() {
  return (
    <header className={`${landingStyles.workspaceIntro} ${sceneStyles.intro}`}>
      <div>
        <p className={landingStyles.sceneLabel}>Проверьте на своей нише</p>
        <h2 className={landingStyles.sceneHeading}>Настройте профиль — выдача обновится.</h2>
      </div>
      <p className={landingStyles.sceneLead}>
        Профиль влияет на порядок и приоритет. Сначала покажем несколько компаний,
        которые есть смысл изучить сегодня.
      </p>
    </header>
  );
}

function PreviewForm({ input, presets }: { input: PublicPreviewInput; presets: PreviewPreset[] }) {
  return (
    <div className={`${landingStyles.workspaceControls} ${sceneStyles.controls}`}>
      <div className={`${landingStyles.presetStrip} ${sceneStyles.presetStrip}`} aria-label="Готовые профили">
        <span>Готовые профили</span>
        {presets.map((preset) => {
          const params = new URLSearchParams({
            specialization: preset.specialization,
            targetCity: preset.targetCity,
            includeKeywords: preset.includeKeywords,
            excludeKeywords: preset.excludeKeywords,
            dailyDigestLimit: String(preset.dailyDigestLimit),
          });
          return (
            <a key={preset.id} href={`/?${params.toString()}#preview`}>
              {preset.label}
            </a>
          );
        })}
      </div>

      <LandingTrackedSubmit
        as="form"
        id="preview-configurator"
        className={`${landingStyles.workspaceForm} ${sceneStyles.workspaceForm}`}
        action="/"
        method="get"
        context="preview_configurator"
        eventName="preview_submitted"
      >
        <label>
          <span>Специализация</span>
          <Input name="specialization" maxLength={160} defaultValue={input.specialization} placeholder="Например, инженерный подбор" />
        </label>
        <label>
          <span>География</span>
          <Input name="targetCity" maxLength={120} defaultValue={input.targetCity} placeholder="Москва / удалённо" />
        </label>
        <label>
          <span>Кого ищете / сигналы</span>
          <Input name="includeKeywords" maxLength={300} defaultValue={input.includeKeywords} placeholder="конструктор, производство, разработка" />
        </label>
        <input type="hidden" name="excludeKeywords" value={input.excludeKeywords} />
        <input type="hidden" name="dailyDigestLimit" value={input.dailyDigestLimit} />
        <button type="submit">Показать компании →</button>
      </LandingTrackedSubmit>
    </div>
  );
}

export function WorkspaceScene(props: WorkspaceSceneProps) {
  const appliedProfile = [
    props.previewInput.specialization,
    props.previewInput.targetCity,
    props.previewInput.includeKeywords,
  ].filter(Boolean);

  return (
    <section
      id="scene-workspace"
      className={`${landingStyles.scene} ${landingStyles.lightScene} ${landingStyles.workspaceScene} ${sceneStyles.section}`}
      data-header-tone="light"
      data-preview-editorial="true"
      data-preview-layout="marketing-demo"
    >
      <div className={landingStyles.workspaceLayout}>
        <WorkspaceIntro />

        <div className={sceneStyles.productFrame} data-product-preview="live-radar">
          <div className={sceneStyles.previewHeader}>
            <span>Интерактивный пример</span>
            <small>Профиль можно менять</small>
          </div>

          <PreviewForm input={props.previewInput} presets={props.previewPresets} />

          <div id="preview-results" className={`${landingStyles.workspaceResults} ${sceneStyles.results}`}>
            <div className={`${landingStyles.workspaceResultsHeader} ${sceneStyles.resultsHeader}`}>
              <div>
                <span>КОМПАНИИ НА СЕГОДНЯ / {String(props.previewState.items.length).padStart(2, "0")}</span>
                <strong>{props.previewState.isPersonalized ? "Выдача по вашему профилю" : "Пример сегодняшней выдачи"}</strong>
                {!props.previewState.isLive ? (
                  <small className={sceneStyles.demoDisclosure}>
                    <strong>Обезличенный пример.</strong> Названия и часть фактов изменены.
                  </small>
                ) : null}
              </div>
              <span data-live={props.previewState.isLive ? "true" : undefined}>
                {props.previewState.isLive ? "live" : "демо"}
              </span>
            </div>

            {props.previewState.isPersonalized && appliedProfile.length > 0 ? (
              <div className={`${landingStyles.appliedProfile} ${sceneStyles.appliedProfile}`} data-applied-profile>
                <span>Применено</span>
                {appliedProfile.map((item) => <strong key={item}>{item}</strong>)}
              </div>
            ) : null}

            {!props.previewState.hasExactMatches && props.previewState.items.length > 0 ? (
              <p className={landingStyles.workspaceMatchNote}>
                Точного совпадения не нашлось — показываем ближайшие компании по вашему профилю.
              </p>
            ) : null}

            {props.previewState.items.length === 0 ? (
              <div className={landingStyles.workspaceEmpty}>
                <span>Сегодня по этому профилю ничего не найдено.</span>
                <strong>Измените специализацию или географию.</strong>
              </div>
            ) : (
              <WorkspaceLeadList
                items={props.previewState.items}
                checkoutHref={props.checkoutHref}
                canCheckout={props.canCheckout}
                paymentConfigured={props.paymentConfigured}
              />
            )}
          </div>

          <div className={sceneStyles.productFooter}>
            <a href={props.previewHref}>Запустить радар на 7 дней →</a>
            <span>{DEFAULT_LANDING_DEMO_STORY.company.location} · пример выдачи</span>
          </div>
        </div>
      </div>
    </section>
  );
}
