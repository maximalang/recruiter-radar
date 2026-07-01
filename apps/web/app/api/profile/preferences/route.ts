import { NextRequest, NextResponse } from 'next/server';
import {
  getDeliveryPreferencesByOwnerId,
  saveDeliveryPreferencesByOwnerId,
  normalizeDeliveryFrequency,
  type DeliveryFrequency,
} from '@/lib/deliveryPreferences';
import { getOwnerIdFromSession } from '@/lib/session';

/**
 * PATCH /api/profile/preferences — update the owner's delivery preferences.
 *
 * Auth: signed session cookie. No session → 401. Writes are owner-scoped inside
 * `saveDeliveryPreferencesByOwnerId` (UPDATE ... WHERE owner_id = $1), the same
 * anti-IDOR boundary as the settings action — a caller can only ever change
 * their own profile.
 *
 * PATCH semantics: every field is optional; omitted fields keep their stored
 * value (read-merge-write). Body is JSON:
 *   {
 *     webPushEnabled?, emailDigestEnabled?, digestEmail? | null,
 *     deliveryEnabled?, deliveryTimeLocal? | null,
 *     deliveryTimezone?, deliveryFrequency?
 *   }
 */

export const dynamic = 'force-dynamic';

type PatchBody = {
  webPushEnabled?: unknown;
  emailDigestEnabled?: unknown;
  digestEmail?: unknown;
  deliveryEnabled?: unknown;
  deliveryTimeLocal?: unknown;
  deliveryTimezone?: unknown;
  deliveryFrequency?: unknown;
};

export async function PATCH(request: NextRequest) {
  const ownerId = await getOwnerIdFromSession();
  if (!ownerId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Validate provided fields up-front so a bad type is a 400, not a silent coerce.
  if (body.webPushEnabled !== undefined && typeof body.webPushEnabled !== 'boolean') {
    return NextResponse.json({ error: 'webPushEnabled must be a boolean' }, { status: 400 });
  }
  if (body.emailDigestEnabled !== undefined && typeof body.emailDigestEnabled !== 'boolean') {
    return NextResponse.json({ error: 'emailDigestEnabled must be a boolean' }, { status: 400 });
  }
  if (
    body.digestEmail !== undefined &&
    body.digestEmail !== null &&
    typeof body.digestEmail !== 'string'
  ) {
    return NextResponse.json({ error: 'digestEmail must be a string or null' }, { status: 400 });
  }
  if (body.deliveryEnabled !== undefined && typeof body.deliveryEnabled !== 'boolean') {
    return NextResponse.json({ error: 'deliveryEnabled must be a boolean' }, { status: 400 });
  }
  if (
    body.deliveryTimeLocal !== undefined &&
    body.deliveryTimeLocal !== null &&
    typeof body.deliveryTimeLocal !== 'string'
  ) {
    return NextResponse.json({ error: 'deliveryTimeLocal must be a string or null' }, { status: 400 });
  }
  if (body.deliveryTimezone !== undefined && typeof body.deliveryTimezone !== 'string') {
    return NextResponse.json({ error: 'deliveryTimezone must be a string' }, { status: 400 });
  }
  let deliveryFrequency: DeliveryFrequency | undefined;
  if (body.deliveryFrequency !== undefined) {
    const normalized = normalizeDeliveryFrequency(body.deliveryFrequency);
    if (!normalized) {
      return NextResponse.json(
        { error: 'deliveryFrequency must be one of: daily, weekly' },
        { status: 400 },
      );
    }
    deliveryFrequency = normalized;
  }

  // Read-merge-write: omitted fields keep their current value.
  const current = await getDeliveryPreferencesByOwnerId(ownerId);
  if (!current) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const next = {
    ownerId,
    webPushEnabled:
      body.webPushEnabled !== undefined ? body.webPushEnabled : current.webPushEnabled,
    emailDigestEnabled:
      body.emailDigestEnabled !== undefined
        ? body.emailDigestEnabled
        : current.emailDigestEnabled,
    digestEmail:
      body.digestEmail !== undefined
        ? (body.digestEmail as string | null)
        : current.digestEmail,
    deliveryEnabled:
      body.deliveryEnabled !== undefined ? body.deliveryEnabled : current.deliveryEnabled,
    deliveryTimeLocal:
      body.deliveryTimeLocal !== undefined
        ? (body.deliveryTimeLocal as string | null)
        : current.deliveryTimeLocal,
    deliveryTimezone:
      body.deliveryTimezone !== undefined ? body.deliveryTimezone : current.deliveryTimezone,
    deliveryFrequency: deliveryFrequency ?? current.deliveryFrequency,
  };

  const result = await saveDeliveryPreferencesByOwnerId(next);
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true, preferences: result.preferences });
}
