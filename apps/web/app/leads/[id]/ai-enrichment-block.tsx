import type { StoredAiEnrichment } from '@/lib/ai/enrichment/enrichmentStore';
import s from './ai-enrichment-block.module.css';

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

  const roles = enrichment.detectedRoles.filter((role) => role.title.trim().length > 0);
  const hasSummary = enrichment.hiringPatternSummary.trim().length > 0;
  const hasDepartments = enrichment.departments.length > 0;
  const hasLocations = enrichment.locations.length > 0;

  if (!roles.length && !hasSummary && !hasDepartments && !hasLocations) return null;

  return (
    <section className={s.advisory} aria-labelledby="ai-advisory-title">
      <h2 id="ai-advisory-title">ИИ-подсказка по найму</h2>
      <p className={s.disclaimer}>
        Вспомогательная интерпретация страницы вакансий. Не влияет на силу сигнала или уровень подтверждения; проверьте перед использованием.
      </p>

      {hasSummary ? <p className={s.summary}>{enrichment.hiringPatternSummary}</p> : null}

      {roles.length > 0 ? (
        <div className={s.group}>
          <span className={s.label}>Распознанные роли</span>
          <ul className={s.roles}>
            {roles.map((role, index) => (
              <li key={index}>
                <strong>{role.title}</strong>{role.department ? <span> · {role.department}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className={s.facts}>
        <div><dt>Срочность найма</dt><dd>{URGENCY_LABEL[enrichment.hiringUrgency]}</dd></div>
        {hasDepartments ? <div><dt>Команды</dt><dd>{enrichment.departments.join(', ')}</dd></div> : null}
        {hasLocations ? <div><dt>География</dt><dd>{enrichment.locations.join(', ')}</dd></div> : null}
        <div><dt>Уверенность ИИ</dt><dd>{CONFIDENCE_LABEL[enrichment.confidence]}{enrichment.provider ? ` · ${enrichment.provider}` : ''}</dd></div>
      </dl>
    </section>
  );
}
