import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { listClientProfiles, type ClientProfile } from '@/lib/clientProfiles';
import { getSession } from '@/lib/auth-v2/authorization';
import { getEffectiveEntitlement } from '@/lib/entitlements';
import {
  InternalPageFrame,
  InternalPageHeader,
  formatSignalFreshness,
  LoadingState,
} from '../ui/internal-page';
import { ProductErrorState } from '../ui/product-error-state';
import { StaticEmptyState } from '../ui/static-empty-state';
import { buildAccountNavigation } from '../ui/account-navigation';
import ReviewActions from './review-actions';
import { deriveReviewReason } from './review-reason';
import { pluralizeLeads } from '../leads/page-helpers';
import styles from './review.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'На проверке — Recruiter Radar',
  description: 'Кандидаты, требующие проверки перед отправкой в подборку.',
};

const REVIEW_NAV = buildAccountNavigation('review');

interface ReviewCandidate {
  id: string;
  orgId: string;
  orgName: string;
  score: number;
  confidenceGate: string;
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

function StateLink({ href, label }: { href: string; label: string }) {
  return <Link href={href}>{label}</Link>;
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
    return { items: [], total: 0, error: true };
  }
}

const REVIEW_REASON_LABEL: Record<string, string> = {
  foreign: 'Зарубежный ATS',
  'gate-c': 'Только платформенный источник',
  'single-source': 'Один источник',
};

function confidenceLabel(gate: string): string {
  if (gate === 'A') return 'высокая';
  if (gate === 'B') return 'достаточная';
  if (gate === 'C') return 'требует проверки';
  return 'недостаточно';
}

function ReviewRow({ candidate, clientProfileId }: { candidate: ReviewCandidate; clientProfileId: string }) {
  const reason = deriveReviewReason({
    confidenceGate: candidate.confidenceGate,
    isForeignEmployer: candidate.isForeignEmployer ?? false,
    sourceCount: candidate.sourceFamilies.length,
  });
  const freshness = formatSignalFreshness(candidate.latestPublishedAt)?.label ?? 'дата сигнала не определена';
  const reasonLabel = reason ? (REVIEW_REASON_LABEL[reason.key] ?? reason.key) : 'Требует ручной проверки';

  return (
    <article className={styles.row} data-review-row>
      <div className={styles.identity}>
        <Link href={`/leads/${candidate.id}`} className={styles.company}>{candidate.orgName}</Link>
        <span>{candidate.locationNames.slice(0, 2).join(', ') || 'география не указана'}</span>
      </div>
      <div className={styles.reason}>
        <strong>{reasonLabel}</strong>
        {candidate.reasons.length > 0 ? <span>{candidate.reasons.slice(0, 2).join('; ')}</span> : null}
      </div>
      <div className={styles.proof}>
        <strong>{candidate.vacanciesCount} вакансий · {candidate.sourceFamilies.length} источн.</strong>
        <span>{freshness}</span>
      </div>
      <div className={styles.signal}>
        <strong aria-label={`Сила сигнала ${candidate.score}`}>{candidate.score}</strong>
        <span>{confidenceLabel(candidate.confidenceGate)}</span>
      </div>
      <div className={styles.actions}>
        <Link href={`/leads/${candidate.id}`}>Проверить подтверждения</Link>
        <ReviewActions candidateId={candidate.id} clientProfileId={clientProfileId} />
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
  const authorization = await getSession({ permission: 'leads:read' });
  if (!authorization) {
    return (
      <InternalPageFrame navItems={REVIEW_NAV}>
        <InternalPageHeader title="На проверке" subtitle="Защищённое рабочее пространство" />
        <StaticEmptyState
          title="Нужен вход в аккаунт"
          description="Войдите, чтобы открыть очередь проверки своего workspace."
          action={<StateLink href="/login?returnTo=/review" label="Войти" />}
        />
      </InternalPageFrame>
    );
  }

  const ownerId = authorization.dataOwnerId;
  const entitlement = authorization.workspaceId
    ? await getEffectiveEntitlement(ownerId, { workspaceId: authorization.workspaceId }).catch(() => null)
    : null;
  if (!entitlement) {
    return (
      <InternalPageFrame navItems={REVIEW_NAV}>
        <InternalPageHeader title="На проверке" subtitle="Проверка доступа" />
        <ProductErrorState
          title="Не удалось проверить доступ"
          description="Мы не загружаем очередь, пока сервер не подтвердит права аккаунта."
        >
          <StateLink href="/settings/access" label="Доступ и оплата" />
        </ProductErrorState>
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
        <InternalPageHeader title="На проверке" subtitle="Доступ не активен" />
        <StaticEmptyState
          title="Нужен активный доступ"
          description="Очередь и история сохранены. После активации проверка снова станет доступна."
          action={<StateLink href="/settings/access" label="Проверить доступ" />}
        />
      </InternalPageFrame>
    );
  }

  let allProfiles: ClientProfile[];
  try {
    allProfiles = await listClientProfiles(ownerId);
  } catch {
    return (
      <InternalPageFrame navItems={REVIEW_NAV}>
        <InternalPageHeader title="На проверке" subtitle="Радар" />
        <ProductErrorState
          title="Не удалось загрузить профили радара"
          description="Это временная ошибка данных, а не пустая очередь."
        >
          <StateLink href="/settings/radar" label="Открыть настройки радара" />
        </ProductErrorState>
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
        title="На проверке"
        subtitle="Кандидаты с уровнем подтверждения C, иностранные работодатели и одиночный источник — проверьте доказательства перед доставкой как лид"
      />

      {profiles.length === 0 && allProfiles.length > 0 ? (
        <StaticEmptyState
          title="Профиль радара приостановлен"
          description="Настройки и решения сохранены, но очередь не обновляется. Включите профиль, чтобы продолжить проверку новых кандидатов."
          action={<StateLink href="/settings/radar" label="Включить профиль радара" />}
        />
      ) : profiles.length === 0 ? (
        <StaticEmptyState
          title="Нет клиентских профилей"
          description="Создайте профиль в онбординге, чтобы увидеть очередь проверки."
          action={<StateLink href="/onboarding" label="Настроить радар" />}
        />
      ) : (
        <>
          {profiles.length > 1 ? (
            <form method="GET" className={styles.filters}>
              <label>Профиль клиента
                <select name="clientProfileId" defaultValue={activeProfileId}>
                  {profiles.map((profile: ClientProfile) => (
                    <option key={profile.id} value={profile.id}>{profile.agencyName ?? `Профиль #${profile.id}`}</option>
                  ))}
                </select>
              </label>
              <button type="submit">Показать</button>
            </form>
          ) : null}

          <p className={styles.summary}><strong>{reviewData.total}</strong> на проверке</p>

          {reviewData.error ? (
            <ProductErrorState
              title="На проверке не загрузилась"
              description="Кандидаты с уровнем подтверждения C и одиночным источником собираются из доказательств. Повторите через минуту — если очередь не появится, напишите поддержку."
            />
          ) : (
            <Suspense fallback={<LoadingState variant="skeleton" />}>
              {reviewData.items.length === 0 ? (
                <StaticEmptyState
                  title="Очередь пуста"
                  description="Нет кандидатов, требующих проверки. Новые карьерные страницы и платформенные сигналы появляются ежедневно — кандидаты с уровнем подтверждения C или одиночным источником появятся здесь автоматически."
                />
              ) : (
                <div className={styles.list} role="list">
                  <div className={styles.listHeader}>
                    <strong>{reviewData.items.length}</strong> {pluralizeLeads(reviewData.items.length)} на проверке
                  </div>
                  {reviewData.items.map((candidate) => (
                    <ReviewRow key={candidate.id} candidate={candidate} clientProfileId={activeProfileId} />
                  ))}
                </div>
              )}
            </Suspense>
          )}
        </>
      )}
    </InternalPageFrame>
  );
}
