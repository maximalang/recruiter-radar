import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPool } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId")?.trim() ?? null;

  if (!orderId || !/^\d+$/.test(orderId)) {
    return NextResponse.json({ error: "Missing or invalid orderId." }, { status: 400 });
  }

  const ownerId = (await cookies()).get("rr_user_id")?.value?.trim() ?? null;

  if (!ownerId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const pool = getPool();

  if (!pool) {
    return NextResponse.json({ error: "DATABASE_URL is not set." }, { status: 500 });
  }

  const result = await pool.query<{ telegramChatId: string | null }>(
    `
      SELECT cp.telegram_chat_id::TEXT AS "telegramChatId"
      FROM checkout_orders co
      LEFT JOIN client_profiles cp ON cp.id = (co.payload->>'clientProfileId')::BIGINT
      WHERE co.id = $1
        AND co.user_id::TEXT = $2
        AND co.status = 'paid'
      LIMIT 1
    `,
    [orderId, ownerId]
  );

  if (result.rowCount !== 1) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const connected = result.rows[0].telegramChatId != null;

  return NextResponse.json({ connected });
}
