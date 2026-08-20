import { formatLawfulContactPath, deriveWhyNow } from "../../lib/leads-data";
import { formatVacanciesCount } from "../../lib/format/plural";
import type { getPublicSampleDigestState } from "../../lib/publicProduct";
import {
  buildPreviewEvidenceItems,
  cleanEmployerName,
  formatLocationCaption,
  formatVacancyFreshness,
  pickEvidenceTitles,
} from "../home-page-components";
import { RouteGlyph } from "./brand-glyphs";
import styles from "./landing.module.css";
import sceneStyles from "./workspace-scene.module.css";

export type PreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

function formatPublicConfidence(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "high": return "Высокая";
    case "medium": return "Средняя";
    case "low": return "Низкая";
    default: return value.replace(" / ", " · ");
  }
}

export default function WorkspaceLead({ item, defaultOpen }: { item: PreviewItem; defaultOpen: boolean }) {
  const whyNow = deriveWhyNow(item.reasons) || "Активность найма подтверждена источниками";
  const contactPath = formatLawfulContactPath(item.lawfulContactPath) || "Корпоративный путь нужно уточнить";
  const location = formatLocationCaption(item.location_names);
  const vacanciesCaption = formatVacanciesCount(item.vacancies_count);
  const employerName = cleanEmployerName(item.employer_name);
  const freshness = formatVacancyFreshness(item.latest_published_at);
  const confidence = formatPublicConfidence(item.confidenceLabel);
  const evidence = buildPreviewEvidenceItems({
    whyNow,
    vacanciesCaption,
    evidenceTitles: pickEvidenceTitles(item.evidence_titles, 4),
    sourceFamilies: item.source_families,
    limit: 2,
  });

  return (
    <article
      className={`${styles.workspaceLead} ${defaultOpen ? sceneStyles.leadPrimary : sceneStyles.leadSecondary}`}
      data-lead-row="true"
      data-primary-lead={defaultOpen || undefined}
      data-outreach-mode={defaultOpen ? "Сообщения не отправляются автоматически" : undefined}
    >
      <div className={`${styles.workspaceLeadRow} ${sceneStyles.leadRow}`}>
        <span className={styles.workspaceRank}>{String(item.rank).padStart(2, "0")}</span>
        <span className={styles.workspaceCompany} data-lead-company>
          <strong>{employerName}</strong>
          <small>{[location, vacanciesCaption].filter(Boolean).join(" · ")}</small>
        </span>
        <span className={`${styles.workspaceSignal} ${sceneStyles.leadSignal}`} data-lead-why-now>{whyNow}</span>
        <span className={styles.workspaceScore} data-lead-confidence>
          <b className={sceneStyles.confidence}>{confidence}</b>
        </span>
      </div>

      {defaultOpen ? (
        <div className={`${styles.workspaceLeadBody} ${sceneStyles.leadBody}`} data-selected-lead-detail>
          <div className={sceneStyles.primaryReason} data-primary-proof>
            <span>Почему сейчас</span>
            <p>{freshness ? `${whyNow} Последнее подтверждение — ${freshness}.` : whyNow}</p>
          </div>

          <div className={`${styles.workspaceEvidence} ${sceneStyles.evidenceBlock}`}>
            <span>Подтверждения и источники</span>
            <ul>{evidence.map((fact) => <li key={fact}><RouteGlyph size={14} />{fact}</li>)}</ul>
          </div>

          <div className={sceneStyles.outcomeGrid}>
            <div className={sceneStyles.outcomeMeta}>
              <span>Официальный контакт</span>
              <p>{contactPath}</p>
            </div>
            <div className={sceneStyles.outcomeMeta}>
              <span>Уверенность</span>
              <p><strong>{confidence}</strong></p>
            </div>
            <div className={sceneStyles.nextMove}>
              <span>Следующий ход</span>
              <p>{item.opener?.trim() || "Проверить факты и выбрать безопасный путь обращения"}</p>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
