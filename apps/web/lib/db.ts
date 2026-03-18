import { Pool } from "pg";

type LeadRow = {
  id: number;
  orgName: string;
  status: "new" | "saved" | "contacted" | "dismissed";
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
        l.status,
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
