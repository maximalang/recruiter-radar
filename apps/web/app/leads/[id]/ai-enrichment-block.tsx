import type { StoredAiEnrichment } from '@/lib/ai/enrichment/enrichmentStore';
import { ContentCard, ContentCardTitle, internalPageClasses as ipStyles } from '../../ui/internal-page';
import { SparkIcon } from '../../ui/icons';
import s from './ai-enrichment-block.module.css';

/**
 * AI-enrichment block for the lead detail page.
 *
 * Renders ONLY when a successful enrichment was persisted (`ai_enrichment` is
 * non-null). It is an explicitly-labelled "AI-подсказка" — a SECONDARY advisory
 * layer that sits BELOW the deterministic evidence card and is visually muted so
 * it can never be mistaken for source-of-truth evidence. It shows nothing that
 * feeds the score or the confidence gate; those remain deterministic.
 *
 * Returns null when there is no enrichment, so the caller can drop it in
 * unconditionally without its own guard.
 */

const URGENCY_LABEL: Record<StoredAiEnrichment['hiringUrgency'], string> = {
  high: 'Высокая',
  medium: 'Средняя',
  low: 'Низкая',
  unknown: 'Не определена',
};

const CONFIDENCE_LABEL: Record<StoredAiEnrichment['confidence'], string> = {
  high: 'высокая',
  medium: 'средняя',
  low: 'низкая',
};

export default function AiEnrichmentBlock({ enrichment }: { enrichment: StoredAiEnrichment | null }) {
  if (!enrichment) return null;

  const roles = enrichment.detectedRoles.filter((r) => r.title.trim().length > 0);
  const hasSummary = enrichment.hiringPatternSummary.trim().length > 0;
  const hasDepartments = enrichment.departments.length > 0;
  const hasLocations = enrichment.locations.length > 0;

  // Nothing usable to show — render nothing rather than an empty labelled card.
  if (!roles.length && !hasSummary && !hasDepartments && !hasLocations) return null;

  return (
    <ContentCard variant="muted" className={s.aiCard}>
      <ContentCardTitle>
        <span className={s.aiBadge} aria-hidden="true"><SparkIcon className={s.aiBadgeIcon} /> AI</span>
        AI-подсказка по найму
      </ContentCardTitle>

      <p className={s.aiDisclaimer}>
        Распознано ИИ со страницы вакансий. Вспомогательная подсказка — не влияет на
        оценку и уровень доверия; проверьте перед использованием.
      </p>

      {hasSummary && <p className={s.aiSummary}>{enrichment.hiringPatternSummary}</p>}

      {roles.length > 0 && (
        <div className={s.aiSection}>
          <div className={s.aiSectionLabel}>Похоже, нанимают на роли</div>
          <ul className={s.aiRoleList}>
            {roles.map((role, i) => (
              <li key={i} className={s.aiRoleItem}>
                <span className={s.aiRoleTitle}>{role.title}</span>
                {role.department && <span className={s.aiRoleDept}>· {role.department}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={s.aiMetaGrid}>
        <div className={s.aiMeta}>
          <span className={s.aiMetaLabel}>Срочность найма</span>
          <span className={s.aiMetaValue}>{URGENCY_LABEL[enrichment.hiringUrgency]}</span>
        </div>
        {hasDepartments && (
          <div className={s.aiMeta}>
            <span className={s.aiMetaLabel}>Команды</span>
            <span className={s.aiMetaValue}>{enrichment.departments.join(', ')}</span>
          </div>
        )}
        {hasLocations && (
          <div className={s.aiMeta}>
            <span className={s.aiMetaLabel}>География</span>
            <span className={s.aiMetaValue}>{enrichment.locations.join(', ')}</span>
          </div>
        )}
      </div>

      <p className={ipStyles.bodyTextMuted}>
        Уверенность ИИ: {CONFIDENCE_LABEL[enrichment.confidence]}
        {enrichment.provider ? ` · ${enrichment.provider}` : ''}
      </p>
    </ContentCard>
  );
}
