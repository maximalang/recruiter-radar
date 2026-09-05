import Link from "next/link";

import {
  getStaticDemoDigestItems,
} from "../../lib/publicProduct";
import {
  LANDING_ANALYTICS_CONTEXT,
  LANDING_ANALYTICS_EVENT,
} from "../../lib/landing-analytics-contract";
import { pluralCompanies } from "../../lib/format/plural";
import LandingPreviewInteractions from "../landing-preview-interactions";
import styles from "./landing.module.css";
import sceneStyles from "./workspace-scene.module.css";
import WorkspaceLead from "./workspace-lead";
import WorkspaceLeadList from "./workspace-lead-list";

/**
 * Static product story (landing polish v2, stage 2): the interactive
 * configurator is replaced by one fixed, clearly-labeled demo scenario
 * (anchor date 2026-05-12). Signals → dossier → cabinet, with colored
 * story steps and source badges. No form, no presets, no URL-driven
 * personalization: every visit renders the same honest demo.
 */

const STORY_STEPS = [
  {
    key: "signals",
    tone: "signal",
    title: "Сигналы",
    text: "Радар находит публичные сигналы найма: новые вакансии, повторные публикации и редкие роли.",
  },
  {
    key: "dossier",
    tone: "warning",
    title: "Досье",
    text: "По каждой компании собирается досье: почему сейчас, подтверждающие факты, источники и уверенность.",
  },
  {
    key: "cabinet",
    tone: "accent",
    title: "Рабочий кабинет",
    text: "Приоритетный список и следующий безопасный шаг ждут в кабинете. Сообщения компаниям отправляете вы.",
  },
] as const;

const SOURCE_BADGES = [
  { key: "hh", label: "Вакансии" },
  { key: "career-pages", label: "Карьерные страницы" },
  { key: "egrul-fns", label: "Реестры ЕГРЮЛ" },
  { key: "company-site", label: "Сайты компаний" },
] as const;

type WorkspaceProps = {
  checkoutHref: string;
};

export default function WorkspaceScene(props: WorkspaceProps) {
  const demoItems = getStaticDemoDigestItems();
  const visibleItems = demoItems.slice(0, 5);

  return (
    <section
      id="scene-workspace"
      className={`${styles.scene} ${styles.lightScene} ${styles.workspaceScene} ${sceneStyles.section}`}
      aria-labelledby="workspace-title"
      aria-label="Статичный продуктовый рассказ"
      data-header-tone="light"
      data-motion-reveal="section"
      data-preview-layout="static-story"
    >
      <div className={styles.workspaceLayout} data-preview-section-content>
        <LandingPreviewInteractions />
        <WorkspaceIntro />

        <ol
          className={sceneStyles.storyPath}
          data-story-path="signals-dossier-cabinet"
          aria-label="Путь сигнала: от находки до кабинета"
        >
          {STORY_STEPS.map((step, index) => (
            <li
              key={step.key}
              className={sceneStyles.storyStep}
              data-story-step={step.key}
              data-story-tone={step.tone}
            >
              <span className={sceneStyles.storyIndex}>{`0${index + 1}`}</span>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>

        <div
          id="preview-configurator"
          className={sceneStyles.productFrame}
          data-preview-configurator
          data-product-preview="static-story"
          data-preview-editorial="true"
        >
          <div className={sceneStyles.previewHeader} data-preview-rail aria-hidden="true">
            <span>Recruiter Radar</span>
            <small>ПРИМЕР</small>
          </div>

          <div
            id="preview-results"
            className={`${styles.workspaceResults} ${sceneStyles.results}`}
            data-preview-results
            data-preview-results-ready
          >
            <div className={`${styles.workspaceResultsHeader} ${sceneStyles.resultsHeader}`}>
              <div>
                <strong>Пример выдачи · демо-сценарий от 12 мая</strong>
                <small className={sceneStyles.demoDisclosure}>
                  <strong>Обезличенный пример.</strong> Названия и часть фактов изменены; логика приоритета и типы источников сохранены.
                </small>
              </div>
              <span>{visibleItems.length} {pluralCompanies(visibleItems.length)}</span>
            </div>

            <div
              className={sceneStyles.sourceBadges}
              aria-label="Типы источников в демо-сценарии"
              data-source-badges
            >
              <span>Источники</span>
              {SOURCE_BADGES.map((badge) => (
                <em key={badge.key} data-source-badge={badge.key}>{badge.label}</em>
              ))}
            </div>

            <WorkspaceLeadList>
              {visibleItems.map((item, index) => (
                <WorkspaceLead
                  key={`${item.org_id}-${item.rank}`}
                  item={item}
                  defaultOpen={index === 0}
                />
              ))}
            </WorkspaceLeadList>

            <div className={sceneStyles.productFooter}>
              <Link
                className={sceneStyles.checkout}
                prefetch={false}
                href={props.checkoutHref}
                data-analytics-event={LANDING_ANALYTICS_EVENT.checkoutStarted}
                data-analytics-context={LANDING_ANALYTICS_CONTEXT.preview}
              >
                Запустить радар на 7 дней →
              </Link>
              <span>7 дней · без автопродления</span>
            </div>
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
        <p className={styles.sceneLabel}>Пример выдачи · демо-сценарий</p>
        <h2 id="workspace-title" className={styles.sceneHeading}>Так радар ведёт компанию от сигнала до вашего решения.</h2>
      </div>
      <p className={styles.sceneLead}>
        Один обезличенный сценарий от 12 мая: какие сигналы находит радар, как собирает досье с источниками и что вы видите в рабочем списке перед контактом.
      </p>
    </header>
  );
}

/** Presentational shell kept for the page-level suspense export contract. */
export function WorkspaceResultsSkeleton() {
  return (
    <div data-preview-results-skeleton aria-busy="true" aria-label="Результаты примера загружаются">
      <div className={styles.workspaceSkeleton}>
        <span /><span /><span />
      </div>
    </div>
  );
}
