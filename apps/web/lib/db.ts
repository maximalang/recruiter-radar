import { Pool } from "pg";

export const ACTIONABLE_LEAD_STATUSES = [
  "new",
  "contacted",
  "replied",
  "won",
  "badfit",
  "snooze"
] as const;

export type ActionableLeadStatus = (typeof ACTIONABLE_LEAD_STATUSES)[number];
export type LeadStatus =
  | ActionableLeadStatus
  | "saved"
  | "dismissed";

type LeadRow = {
  id: number;
  orgName: string;
  status: LeadStatus;
  score: number | null;
  lastSignalAt: string | null;
  userName: string;
};

type LeadsResult = {
  rows: LeadRow[];
  error: string | null;
};

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarPool?: Pool;
};

export function isActionableLeadStatus(value: FormDataEntryValue | null): value is ActionableLeadStatus {
  return typeof value === "string" && ACTIONABLE_LEAD_STATUSES.includes(value as ActionableLeadStatus);
}

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  if (!globalForPg.recruiterRadarPool) {
    globalForPg.recruiterRadarPool = new Pool({
      connectionString
    });
  }

  return globalForPg.recruiterRadarPool;
}

export async function getLeads(): Promise<LeadsResult> {
  const pool = getPool();

  if (!pool) {
    return {
      rows: [],
      error: "DATABASE_URL is not set."
    };
  }

  try {
    const result = await pool.query<LeadRow>(`
      SELECT
        l.id,
        o.name AS "orgName",
        l.status::text AS "status",
        l.score,
        l.last_signal_at::text AS "lastSignalAt",
        COALESCE(NULLIF(u.full_name, ''), u.email) AS "userName"
      FROM leads l
      INNER JOIN orgs o ON o.id = l.org_id
      INNER JOIN users u ON u.id = l.user_id
      ORDER BY l.last_signal_at DESC NULLS LAST, l.id DESC
    `);

    return {
      rows: result.rows,
      error: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error.";

    return {
      rows: [],
      error: `Failed to load leads: ${message}`
    };
  }
}

export async function updateLeadStatus(
  leadId: number,
  nextStatus: ActionableLeadStatus
): Promise<boolean> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const leadResult = await client.query<{ status: LeadStatus }>(
      `
        SELECT status::text AS "status"
        FROM leads
        WHERE id = $1
        FOR UPDATE
      `,
      [leadId]
    );

    if (leadResult.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }

    const currentStatus = leadResult.rows[0].status;

    if (currentStatus === nextStatus) {
      await client.query("COMMIT");
      return false;
    }

    await client.query(
      `
        UPDATE leads
        SET status = $2
        WHERE id = $1
      `,
      [leadId, nextStatus]
    );

    await client.query(
      `
        INSERT INTO lead_status (
          lead_id,
          from_status,
          to_status,
          changed_by,
          note
        )
        VALUES ($1, $2, $3, 'user', $4)
      `,
      [leadId, currentStatus, nextStatus, `Updated from web UI to ${nextStatus}`]
    );

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
