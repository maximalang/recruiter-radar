import { Suspense } from 'react';
import { listClientProfiles, type ClientProfile } from '@/lib/clientProfiles';
import {
  InternalPageFrame,
  InternalPageHeader,
  MetricGrid,
  MetricCard,
  GateBadgeInline,
  ScoreBar,
  TableCard,
  EmptyState,
  ContentCard,
  type NavItem,
} from '../ui/internal-page';
import { internalPageClasses as ipStyles } from '../ui/internal-page';
import ReviewActions from './review-actions';

export const dynamic = 'force-dynamic';

const REVIEW_NAV: NavItem[] = [
  { href: '/dashboard', label: '📊 Дашборд' },
  { href: '/leads', label: '🎯 Лиды' },
  { href: '/review', label: '🔍 Ревью', active: true },
];

interface ReviewCandidate {
  id: string;
  orgId: string;
  orgName: string;
  score: number;
  confidenceGate: string;
  vacanciesCount: number;
  distinctVacancyNamesCount: number;
  latestPublishedAt: string | null;
  reasons: string[];
  sourceFamilies: string[];
  evidenceTitles: string[];
  locationNames: string[];
  createdAt: string;
}

async function getReviewCandidates(
  clientProfileId: string,
  limit: number,
  offset: number,
): Promise<{ items: ReviewCandidate[]; total: number }> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const url = new URL('/api/review', baseUrl);
  url.searchParams.set('clientProfileId', clientProfileId);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { items: [], total: 0 };
    return res.json();
  } catch {
    return { items: [], total: 0 };
  }
}

function ReviewRow({
  candidate,
  clientProfileId,
}: {
  candidate: ReviewCandidate;
  clientProfileId: string;
}) {
  return (
    <tr className={ipStyles.dataTableTr}>
      <td className={ipStyles.dataTableTd}>
        <div className={ipStyles.leadOrgName}>{candidate.orgName}</div>
        {candidate.locationNames.length > 0 && (
          <div className={ipStyles.leadLocation}>
            📍 {candidate.locationNames.slice(0, 2).join(', ')}
          </div>
        )}
      </td>
      <td className={ipStyles.dataTableTd} style={{ minWidth: '140px' }}>
        <ScoreBar score={candidate.score} />
      </td>
      <td className={ipStyles.dataTableTd}>
        <GateBadgeInline gate={candidate.confidenceGate} />
      </td>
      <td className={ipStyles.dataTableTd}>
        <div className={ipStyles.leadMeta}>
          {candidate.vacanciesCount > 0 && (
            <span>💼 {candidate.vacanciesCount} вакансий</span>
          )}
          {candidate.evidenceTitles.length > 0 && (
            <span>📋 {candidate.evidenceTitles.length} доказательств</span>
          )}
        </div>
      </td>
      <td className={ipStyles.dataTableTd}>
        <div className={ipStyles.leadMeta}>
          {candidate.sourceFamilies.length > 0 && (
            <span>📡 {candidate.sourceFamilies.join(', ')}</span>
          )}
        </div>
      </td>
      <td className={ipStyles.dataTableTd}>
        <ReviewActions
          candidateId={candidate.id}
          clientProfileId={clientProfileId}
        />
      </td>
    </tr>
  );
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    clientProfileId?: string;
    limit?: string;
    offset?: string;
  }>;
}) {
  const params = await searchParams;
  const profiles = await listClientProfiles();

  const activeProfileId =
    params.clientProfileId ?? profiles[0]?.id?.toString() ?? '';

  const limit = Math.min(Number(params.limit ?? 50), 200);
  const offset = Math.max(Number(params.offset ?? 0), 0);

  const reviewData = activeProfileId
    ? await getReviewCandidates(activeProfileId, limit, offset)
    : { items: [], total: 0 };

  return (
    <InternalPageFrame navItems={REVIEW_NAV}>
      <InternalPageHeader
        title="Очередь ревью"
        subtitle="Лиды, требующие проверки аналитиком перед доставкой"
      />

      {profiles.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="Нет клиентских профилей"
          text="Создайте профиль в онбординге, чтобы увидеть очередь ревью."
        />
      ) : (
        <>
          {profiles.length > 1 && (
            <ContentCard>
              <div className={ipStyles.filterBar}>
                <label className={ipStyles.filterLabel}>
                  Профиль клиента:{' '}
                  <select
                    className={ipStyles.filterSelect}
                    defaultValue={activeProfileId}
                    onChange={(e) => {
                      const url = new URL(window.location.href);
                      url.searchParams.set('clientProfileId', e.target.value);
                      window.location.href = url.toString();
                    }}
                  >
                    {profiles.map((p: ClientProfile) => (
                      <option key={p.id} value={p.id}>
                        {p.agencyName ?? `Профиль #${p.id}`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </ContentCard>
          )}

          <MetricGrid>
            <MetricCard
              label="На ревью"
              value={reviewData.total}
            />
          </MetricGrid>

          <Suspense fallback={<ContentCard>Загрузка…</ContentCard>}>
            {reviewData.items.length === 0 ? (
              <EmptyState
                icon="✅"
                title="Очередь пуста"
                text="Все лиды проверены. Новые кандидаты появятся автоматически."
              />
            ) : (
              <TableCard>
                <table className={ipStyles.dataTable}>
                  <thead>
                    <tr className={ipStyles.dataTableTr}>
                      <th className={ipStyles.dataTableTh}>Компания</th>
                      <th className={ipStyles.dataTableTh}>Оценка</th>
                      <th className={ipStyles.dataTableTh}>Доверие</th>
                      <th className={ipStyles.dataTableTh}>Доказательства</th>
                      <th className={ipStyles.dataTableTh}>Источники</th>
                      <th className={ipStyles.dataTableTh}>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewData.items.map((candidate) => (
                      <ReviewRow
                        key={candidate.id}
                        candidate={candidate}
                        clientProfileId={activeProfileId}
                      />
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Suspense>
        </>
      )}
    </InternalPageFrame>
  );
}
