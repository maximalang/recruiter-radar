import { Suspense } from 'react';
import type { Metadata } from 'next';
import type { ReactElement, SVGProps } from 'react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { listClientProfiles, type ClientProfile } from '@/lib/clientProfiles';
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization';
import { getEffectiveEntitlement } from '@/lib/entitlements';
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
  LoadingState,
  ErrorState,
} from '../ui/internal-page';
import { buildAccountNavigation } from '../ui/account-navigation';
import { internalPageClasses as ipStyles } from '../ui/internal-page';
import { PinIcon, BriefcaseIcon, FileIcon, CheckIcon, TargetIcon } from '../ui/icons';
import ReviewActions from './review-actions';
import { deriveReviewReason } from './review-reason';
import { pluralizeLeads } from '../leads/page-helpers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ревью — Recruiter Radar',
  description: 'Кандидаты, требующие проверки перед отправкой в подборку.',
};

const REVIEW_NAV = buildAccountNavigation('review');

interface ReviewCandidate {
  id: string;
  orgId: string;
  orgName: string;
  score: number;
  confidenceGate: string;
  /**
   * Derived from the candidate payload (extractPayloadFields) — no new SQL.
   * T4.5: the review card shows the foreign reason chip + foreign badge from
   * this flag, instead of the previous hardcoded `isForeign={false}`.
   */
  isForeignEmployer?: boolean;
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
  cookieHeader: string | null,
): Promise<{ items: ReviewCandidate[]; total: number; error?: boolean }> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const url = new URL('/api/review', baseUrl);
  url.searchParams.set('clientProfileId', clientProfileId);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  try {
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
      },
    });
    if (!res.ok) return { items: [], total: 0, error: true };
    const data = await res.json();
    return { items: data.items ?? [], total: data.total ?? 0 };
  } catch {
    // Genuine fetch failure → flag it so the page shows an ErrorState instead
    // of a silent empty queue that reads as "очередь пуста".
    return { items: [], total: 0, error: true };
  }
}

const REVIEW_REASON_LABEL: Record<string, string> = {
  foreign: 'Зарубежный ATS',
  'gate-c': 'Только платформа (C)',
  'single-source': 'Один источник',
};

/**
 * The single reason a candidate is in the review queue — one semantic chip so
 * the analyst sees *why* it's here at a glance (foreign / gate-C / single-
 * source), not just "на проверке". Rendered with the reason's SVG icon.
 */
function ReviewReasonChip(props: { reason: { key: string; icon: (p: SVGProps<SVGSVGElement>) => ReactElement } }) {
  const { reason } = props;
  const Icon = reason.icon;
  const label = REVIEW_REASON_LABEL[reason.key] ?? reason.key;
  return (
    <span className={ipStyles.reviewReasonChip} data-reason={reason.key} title={`Причина проверки: ${label}`}>
      <Icon className={ipStyles.chipIcon} aria-hidden="true" /> {label}
    </span>
  );
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
  // T4.5 — derive the single reason this candidate is in the queue, from
  // already-available fields. Falls back to null when no reason applies.
  const reason = deriveReviewReason({
    confidenceGate: candidate.confidenceGate,
    isForeignEmployer: candidate.isForeignEmployer ?? false,
    sourceCount: candidate.sourceFamilies.length,
  });

  return (
    <article className={ipStyles.leadCard}>
      <div className={ipStyles.leadCardRail} data-tone="neutral" aria-hidden="true" />
      <div className={ipStyles.leadCardBody}>
        <div className={ipStyles.leadCardHead}>
          <div className={ipStyles.leadCardHeadMain}>
            <Link href={`/leads/${candidate.id}`} className={ipStyles.leadLink}>
              <span className={ipStyles.leadCardOrg}>{candidate.orgName}</span>
            </Link>
            <div className={ipStyles.leadCardTags}>
              <ScoreBandChip score={candidate.score} />
              <GateBadgeInline gate={candidate.confidenceGate} />
              <ForeignEmployerBadge isForeign={candidate.isForeignEmployer ?? false} />
              {reason ? <ReviewReasonChip reason={reason} /> : null}
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
              <PinIcon className={ipStyles.chipIcon} /> {candidate.locationNames.slice(0, 2).join(', ')}
            </span>
          )}
          {candidate.vacanciesCount > 0 && (
            <span className={ipStyles.leadMetaChip}><BriefcaseIcon className={ipStyles.chipIcon} /> {candidate.vacanciesCount} вакансий</span>
          )}
          {candidate.evidenceTitles.length > 0 && (
            <span className={ipStyles.leadMetaChip}>
              <FileIcon className={ipStyles.chipIcon} /> {candidate.evidenceTitles.slice(0, 2).join(' · ')}
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
  // Keep authentication, canonical entitlement, and data failures distinct.
  // A missing session must never look like an account with zero profiles.
  const ownerId = await getAuthorizedOwnerId('leads:read');
  if (!ownerId) {
    return (
      <InternalPageFrame navItems={REVIEW_NAV}>
        <InternalPageHeader title="Очередь проверки" subtitle="Защищённое рабочее пространство" />
        <EmptyState title="Нужен вход в аккаунт" text="Войдите, чтобы открыть очередь проверки своего workspace." action={{ href: '/login?returnTo=/review', label: 'Войти' }} />
      </InternalPageFrame>
    );
  }

  const entitlement = await getEffectiveEntitlement(ownerId).catch(() => null);
  if (!entitlement) {
    return (
      <InternalPageFrame navItems={REVIEW_NAV}>
        <InternalPageHeader title="Очередь проверки" subtitle="Проверка доступа" />
        <ErrorState title="Не удалось проверить доступ" description="Мы не загружаем очередь, пока сервер не подтвердит права аккаунта." action={{ href: '/settings/access', label: 'Доступ и оплата' }} />
      </InternalPageFrame>
    );
  }
  if (
    entitlement.status !== 'active'
    || !entitlement.features.includes('dashboard')
    || !entitlement.features.includes('api')
  ) {
    return (
      <InternalPageFrame navItems={REVIEW_NAV}>
        <InternalPageHeader title="Очередь проверки" subtitle="Доступ не активен" />
        <EmptyState title="Нужен активный доступ" text="Очередь и история сохранены. После активации проверка снова станет доступна." action={{ href: '/settings/access', label: 'Проверить доступ' }} />
      </InternalPageFrame>
    );
  }

  let allProfiles: ClientProfile[];
  try {
    allProfiles = await listClientProfiles(ownerId);
  } catch {
    return (
      <InternalPageFrame navItems={REVIEW_NAV}>
        <InternalPageHeader title="Очередь проверки" subtitle="Radar" />
        <ErrorState title="Не удалось загрузить профили Radar" description="Это временная ошибка данных, а не пустая очередь." action={{ href: '/settings/radar', label: 'Открыть настройки Radar' }} />
      </InternalPageFrame>
    );
  }
  const profiles = allProfiles.filter((profile) => profile.isActive);

  const activeProfileId =
    profiles.some((profile) => profile.id.toString() === params.clientProfileId)
      ? params.clientProfileId ?? ''
      : profiles[0]?.id?.toString() ?? '';

  const limit = Math.min(Number(params.limit ?? 50), 200);
  const offset = Math.max(Number(params.offset ?? 0), 0);

  const cookieHeader = activeProfileId ? (await headers()).get('cookie') : null;
  const reviewData = activeProfileId
    ? await getReviewCandidates(activeProfileId, limit, offset, cookieHeader)
    : { items: [], total: 0 };

  return (
    <InternalPageFrame navItems={REVIEW_NAV}>
      <InternalPageHeader
        title="Очередь проверки"
        subtitle="Кандидаты с уверенностью C, иностранные работодатели и одиночный источник — проверьте доказательства перед доставкой как лид"
      />

      {profiles.length === 0 && allProfiles.length > 0 ? (
        <EmptyState
          icon={TargetIcon}
          title="Профиль Radar приостановлен"
          text="Настройки и решения сохранены, но очередь не обновляется. Включите профиль, чтобы продолжить проверку новых кандидатов."
          action={{ href: '/settings/radar', label: 'Включить профиль Radar' }}
        />
      ) : profiles.length === 0 ? (
        <EmptyState
          icon={TargetIcon}
          title="Нет клиентских профилей"
          text="Создайте профиль в онбординге, чтобы увидеть очередь проверки."
          action={{ href: '/onboarding', label: 'Настроить Radar' }}
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

          {reviewData.error ? (
            <ErrorState
              title="Очередь проверки не загрузилась"
              description="Кандидаты с уверенностью C и одиночным источником собираются из доказательств. Повторите через минуту — если очередь не появится, напишите поддержку."
            />
          ) : (
          <Suspense fallback={<LoadingState variant="skeleton" />}>
            {reviewData.items.length === 0 ? (
              <EmptyState
                icon={CheckIcon}
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
          )}
        </>
      )}
    </InternalPageFrame>
  );
}
