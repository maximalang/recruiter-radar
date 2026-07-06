import { Suspense } from 'react';
import Link from 'next/link';
import { listClientProfiles, type ClientProfile } from '@/lib/clientProfiles';
import { getOwnerIdFromSession } from '@/lib/session';
import {
  InternalPageFrame,
  InternalPageHeader,
  MetricGrid,
  MetricCard,
  GateBadgeInline,
  ScoreBar,
  ScoreBandChip,
  SignalFreshnessChip,
  ForeignEmployerBadge,
  EvidenceTag,
  SourceChip,
  TableCard,
  EmptyState,
  ContentCard,
  type NavItem,
} from '../ui/internal-page';
import { internalPageClasses as ipStyles } from '../ui/internal-page';
import ReviewActions from './review-actions';
import { pluralizeLeads } from '../leads/page-helpers';

export const dynamic = 'force-dynamic';

const REVIEW_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Дашборд' },
  { href: '/leads', label: 'Лиды' },
  { href: '/review', label: 'Ревью', active: true },
  { href: '/settings/profile', label: 'Профиль' },
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

/**
 * One review candidate — rendered with the SAME vocabulary as a /leads card
 * (gate badge, score band, evidence chips, freshness, foreign badge) so the
 * analyst sees the same lead shape they triage on /leads. The whole card links
 * to the lead detail so evidence can be reviewed before deciding; approve/
 * reject live in a footer row so they never trigger on an accidental card click.
 */
function ReviewCard({
  candidate,
  clientProfileId,
}: {
  candidate: ReviewCandidate;
  clientProfileId: string;
}) {
  return (
    <article className={ipStyles.leadCard}>
      <div className={ipStyles.leadCardRail} aria-hidden="true" />
      <div className={ipStyles.leadCardBody}>
        <div className={ipStyles.leadCardHead}>
          <div className={ipStyles.leadCardHeadMain}>
            <Link href={`/leads/${candidate.id}`} className={ipStyles.leadLink}>
              <span className={ipStyles.leadCardOrg}>{candidate.orgName}</span>
            </Link>
            <div className={ipStyles.leadCardTags}>
              <ScoreBandChip score={candidate.score} />
              <GateBadgeInline gate={candidate.confidenceGate} />
              <ForeignEmployerBadge isForeign={false} />
            </div>
          </div>
          <div className={ipStyles.leadCardHeadAside}>
            <div className={ipStyles.leadCardScore}>
              <ScoreBar score={candidate.score} />
            </div>
          </div>
        </div>

        {candidate.reasons.length > 0 && (
          <div className={ipStyles.leadFieldRow} data-kind="why">
            <span className={ipStyles.leadFieldLabel}>Почему кандидат</span>
            <span className={ipStyles.leadFieldValue}>
              {candidate.reasons.slice(0, 2).join('; ')}
            </span>
          </div>
        )}

        <div className={ipStyles.leadCardFooter}>
          <SignalFreshnessChip latestPublishedAt={candidate.latestPublishedAt} />
          {candidate.locationNames.length > 0 && (
            <span className={ipStyles.leadMetaChip}>
              📍 {candidate.locationNames.slice(0, 2).join(', ')}
            </span>
          )}
          {candidate.vacanciesCount > 0 && (
            <span className={ipStyles.leadMetaChip}>💼 {candidate.vacanciesCount} вакансий</span>
          )}
          {candidate.evidenceTitles.length > 0 && (
            <span className={ipStyles.leadMetaChip}>
              📋 {candidate.evidenceTitles.slice(0, 2).join(' · ')}
            </span>
          )}
        </div>

        {candidate.sourceFamilies.length > 0 && (
          <div className={ipStyles.chipWrapSm}>
            {candidate.sourceFamilies.map((src) => (
              <SourceChip key={src}>{src}</SourceChip>
            ))}
          </div>
        )}
      </div>
      <div className={ipStyles.leadCardAction}>
        <Link href={`/leads/${candidate.id}`} className={ipStyles.leadOpenBtn}>
          Смотреть доказательства →
        </Link>
        <ReviewActions
          candidateId={candidate.id}
          clientProfileId={clientProfileId}
        />
      </div>
    </article>
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
  // Owner-scope the profile list: without a session, show no profiles (and thus
  // no review queue) rather than another tenant's candidates.
  const ownerId = await getOwnerIdFromSession();
  const profiles = ownerId ? await listClientProfiles(ownerId) : [];

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
        title="Очередь проверки"
        subtitle="Кандидаты с уверенностью C, иностранные работодатели и одиночный источник — проверьте доказательства перед доставкой как лид"
      />

      {profiles.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="Нет клиентских профилей"
          text="Создайте профиль в онбординге, чтобы увидеть очередь проверки."
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
            <MetricCard label="На проверке" value={reviewData.total} tone="info" />
          </MetricGrid>

          <Suspense fallback={<ContentCard>Загрузка…</ContentCard>}>
            {reviewData.items.length === 0 ? (
              <EmptyState
                icon="✅"
                title="Очередь пуста"
                text="Нет кандидатов, требующих проверки. Новые карьерные страницы и платформенные сигналы появляются ежедневно — кандидаты с уверенностью C или одиночным источником появятся здесь автоматически."
              />
            ) : (
              <TableCard>
                <div className={ipStyles.leadsListToolbar}>
                  <div className={ipStyles.leadsListCount}>
                    <strong>{reviewData.items.length}</strong> {pluralizeLeads(reviewData.items.length)} на проверке
                  </div>
                </div>
                <div className={ipStyles.leadsList}>
                  {reviewData.items.map((candidate) => (
                    <ReviewCard
                      key={candidate.id}
                      candidate={candidate}
                      clientProfileId={activeProfileId}
                    />
                  ))}
                </div>
              </TableCard>
            )}
          </Suspense>
        </>
      )}
    </InternalPageFrame>
  );
}
