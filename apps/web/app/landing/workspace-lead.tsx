import { formatLawfulContactPath, deriveWhyNow } from "../../lib/leads-data";
import { formatVacanciesCount } from "../../lib/format/plural";
import { formatScorePoints } from "../../lib/scoring/score-display";
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

type PreviewItem = Awaited<ReturnType<typeof getPublicSampleDigestState>>["items"][number];

export default function WorkspaceLead({ item, defaultOpen }: { item: PreviewItem; defaultOpen: boolean }) {
  const whyNow = deriveWhyNow(item.reasons) || "Активность найма подтверждена источниками";
  const contactPath = formatLawfulContactPath(item.lawfulContactPath) || "Корпоративный путь нужно уточнить";
  const location = formatLocationCaption(item.location_names);
  const vacanciesCaption = formatVacanciesCount(item.vacancies_count);
  const employerName = cleanEmployerName(item.employer_name);
  const points = formatScorePoints(item.total_score);
  const freshness = formatVacancyFreshness(item.latest_published_at);
  const evidence = buildPreviewEvidenceItems({
    whyNow,
    vacanciesCaption,
    evidenceTitles: pickEvidenceTitles(item.evidence_titles, 5),
    sourceFamilies: item.source_families,
    limit: 3,
  });

  return (
    <article
      className={`${styles.workspaceLead} ${sceneStyles.lead} ${defaultOpen ? sceneStyles.leadPrimary : ""}`}
      data-lead-row="true"
      data-primary-lead={defaultOpen || undefined}
    >
      <div className={`${styles.workspaceLeadRow} ${sceneStyles.leadRow}`}>
        <span className={styles.workspaceRank}>{String(item.rank).padStart(2, "0")}</span>
        <span className={styles.workspaceCompany} data-lead-company>
          <strong>{employerName}</strong>
          <small>{[location, vacanciesCaption].filter(Boolean).join(" · ")}</small>
        </span>
        <span className={`${styles.workspaceSignal} ${sceneStyles.leadSignal}`}>{whyNow}</span>
        <span className={styles.workspaceScore} data-lead-confidence>
          <b className={sceneStyles.confidence}>{item.confidenceLabel}</b>
        </span>
      </div>

      {defaultOpen ? (
        <div className={`${styles.workspaceLeadBody} ${sceneStyles.leadBody}`} data-selected-lead-detail>
          <div className={sceneStyles.proofStack}>
            <div className={sceneStyles.proofBlock} data-primary-proof>
              <span>Почему сейчас</span>
              <p>{freshness ? `${whyNow} Последнее изменение — ${freshness}.` : whyNow}</p>
            </div>
            <div className={sceneStyles.proofBlock}>
              <span>Следующий ход</span>
              <p>{item.opener?.trim() || "Проверить факты и выбрать безопасный путь обращения"}</p>
            </div>
            <div className={sceneStyles.proofBlock}>
              <span>Безопасный контакт</span>
              <p>{contactPath}</p>
            </div>
          </div>

          <div className={sceneStyles.sideProof}>
            <div className={`${styles.workspaceEvidence} ${sceneStyles.evidenceBlock}`}>
              <span>Подтверждения и источники</span>
              <ul>{evidence.map((fact) => <li key={fact}><RouteGlyph size={14} />{fact}</li>)}</ul>
            </div>
            <div className={sceneStyles.proofBlock}>
              <span>Уровень подтверждения</span>
              <p>{item.confidenceLabel}. Сила сигнала используется для сортировки, а решение опирается на подтверждения выше.</p>
            </div>
          </div>

          <div className={`${styles.workspaceLeadFooter} ${sceneStyles.leadFooter}`}>
            <span>Сила сигнала {points} · {item.confidenceLabel}</span>
            <strong>Сообщения не отправляются автоматически</strong>
          </div>
        </div>
      ) : null}
    </article>
  );
}
