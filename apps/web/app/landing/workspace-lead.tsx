import { formatLawfulContactPath, deriveWhyNow } from "../../lib/leads-data";
import { formatVacanciesCount } from "../../lib/format/plural";
import { formatScorePoints, scorePercent } from "../../lib/scoring/score-display";
import type { getPublicSampleDigestState } from "../../lib/publicProduct";
import {
  buildPreviewEvidenceItems,
  cleanEmployerName,
  formatLocationCaption,
  formatVacancyFreshness,
  pickEvidenceTitles,
} from "../home-page-components";
import { ArrowGlyph, RouteGlyph } from "./brand-glyphs";
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
  const score = scorePercent(item.total_score);
  const freshness = formatVacancyFreshness(item.latest_published_at);
  const evidence = buildPreviewEvidenceItems({
    whyNow,
    vacanciesCaption,
    evidenceTitles: pickEvidenceTitles(item.evidence_titles, 5),
    sourceFamilies: item.source_families,
    limit: 3,
  });
  const scoreParts = [
    ["Совпадение", item.relevanceSignals.fit],
    ["Намерение", item.relevanceSignals.intent],
    ["Срочность", item.relevanceSignals.urgency],
    ["Контакт", item.relevanceSignals.reachability],
  ] as const;

  return (
    <details
      className={`${styles.workspaceLead} ${sceneStyles.lead} ${defaultOpen ? sceneStyles.leadPrimary : ""}`}
      open={defaultOpen}
      name="preview-leads"
      data-lead-card="true"
      data-primary-lead={defaultOpen || undefined}
    >
      <summary>
        <span className={styles.workspaceRank}>{String(item.rank).padStart(2, "0")}</span>
        <span className={styles.workspaceCompany} data-lead-company>
          <strong>{employerName}</strong>
          <small>{[location, vacanciesCaption].filter(Boolean).join(" · ")}</small>
        </span>
        <span className={styles.workspaceSignal}>{whyNow}</span>
        <span className={styles.workspaceScore} data-lead-score>
          <strong>{points}</strong>
          <small>/100</small>
          {defaultOpen ? <b className={sceneStyles.confidence}>high confidence</b> : null}
        </span>
        <span className={styles.leadChevron} aria-hidden="true"><ArrowGlyph size={16} /></span>
      </summary>
      <div className={`${styles.workspaceLeadBody} ${sceneStyles.leadBody}`}>
        <div className={sceneStyles.proofStack}>
          <div className={sceneStyles.proofBlock} data-primary-proof>
            <span>Почему сейчас</span>
            <p>{freshness ? `${whyNow} Последнее изменение — ${freshness}.` : whyNow}</p>
          </div>
          <div className={sceneStyles.proofBlock}>
            <span>Suggested angle</span>
            <p>{item.opener?.trim() || "Проверить факты и выбрать безопасный путь обращения"}</p>
          </div>
          <div className={sceneStyles.proofBlock}>
            <span>Корпоративный контакт</span>
            <p>{contactPath}</p>
          </div>
        </div>

        <div className={sceneStyles.sideProof}>
          <div className={sceneStyles.factors} aria-label="Состав оценки рекомендации">
            <span>Score factors</span>
            <div className={`${styles.workspaceFiur} ${sceneStyles.factorsList}`}>
              {scoreParts.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <i aria-hidden="true"><b style={{ width: `${Math.round(value * 100)}%` }} /></i>
                  <strong>{Math.round(value * 100)}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className={`${styles.workspaceEvidence} ${sceneStyles.evidenceBlock}`}>
            <span>Факты и источники</span>
            <ul>{evidence.map((fact) => <li key={fact}><RouteGlyph size={14} />{fact}</li>)}</ul>
          </div>
        </div>

        <div className={styles.workspaceLeadFooter}>
          <span>Сила сигнала {score}/100 · уровень уверенности {item.confidence_gate ?? "требует проверки"}</span>
          <strong>Без автоматической отправки</strong>
        </div>
      </div>
    </details>
  );
}
