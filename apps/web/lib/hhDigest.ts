import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Pool } from "pg"

type SourceDigestRow = {
  rank: number
  source_external_id: string | null
  source_display_name: string | null
  vacancies_count: number
  distinct_vacancy_names_count: number
  latest_published_at: string | Date | null
  total_score: number
  is_recent: boolean
}

export type HhDigestItem = {
  rank: number
  hh_employer_id: string
  employer_name: string
  vacancies_count: number
  distinct_vacancy_names_count: number
  latest_published_at: string
  total_score: number
  reasons: [string, string]
  opener: string
}

const digestEvidenceQuery = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/scripts/source-digest-evidence.sql"),
  "utf8"
)

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarHhDigestPool?: Pool
}

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    return null
  }

  if (!globalForPg.recruiterRadarHhDigestPool) {
    globalForPg.recruiterRadarHhDigestPool = new Pool({
      connectionString
    })
  }

  return globalForPg.recruiterRadarHhDigestPool
}

export async function getHhDigestItems(): Promise<HhDigestItem[]> {
  const pool = getPool()

  if (!pool) {
    throw new Error("DATABASE_URL is not set.")
  }

  const result = await pool.query<SourceDigestRow>(digestEvidenceQuery)

  return result.rows.map(buildDigestItem)
}

function buildDigestItem(row: SourceDigestRow): HhDigestItem {
  const reasons = buildReasons(row)

  return {
    rank: row.rank,
    hh_employer_id: row.source_external_id ?? "",
    employer_name: row.source_display_name ?? "",
    vacancies_count: row.vacancies_count,
    distinct_vacancy_names_count: row.distinct_vacancy_names_count,
    latest_published_at: formatTimestamp(row.latest_published_at),
    total_score: row.total_score,
    reasons,
    opener: buildOpener(row.source_display_name ?? "", reasons)
  }
}

function buildReasons(row: Pick<SourceDigestRow, "vacancies_count" | "distinct_vacancy_names_count" | "is_recent">): [string, string] {
  const firstReason =
    row.vacancies_count >= 3
      ? "У компании несколько активных вакансий одновременно"
      : "У компании есть активная вакансия по рекрутингу"

  const secondReason = row.is_recent
    ? "Вакансия опубликована совсем недавно"
    : row.distinct_vacancy_names_count >= 2
      ? "Есть несколько разных ролей, значит найм не точечный"
      : "Роль опубликована недавно, это хороший момент для контакта"

  return [firstReason, secondReason]
}

function buildOpener(employerName: string, reasons: readonly [string, string]): string {
  const safeEmployerName = shortenEmployerName(employerName)
  const [firstReason, secondReason] = reasons.map(toReasonFragment)

  const opener =
    `Здравствуйте! По ${safeEmployerName} видно, что ${firstReason}, а также ${secondReason}. ` +
    "Предлагаю короткий созвон на 10-15 минут, чтобы сверить задачи по найму и понять, можем ли быть полезны. " +
    "Если сейчас неактуально, просто дайте знать."

  if (opener.length <= 450) {
    return opener
  }

  return (
    `Здравствуйте! По ${safeEmployerName} видно: ${firstReason}; ${secondReason}. ` +
    "Предлагаю короткий созвон на 10-15 минут, чтобы понять, можем ли помочь с наймом. " +
    "Если неактуально, просто дайте знать."
  )
}

function shortenEmployerName(value: string): string {
  const name = value.trim()

  if (name.length <= 80) {
    return name || "компании"
  }

  return `${name.slice(0, 77)}...`
}

function toReasonFragment(reason: string): string {
  switch (reason) {
    case "У компании несколько активных вакансий одновременно":
      return "идет несколько активных вакансий одновременно"
    case "У компании есть активная вакансия по рекрутингу":
      return "есть активная вакансия по рекрутингу"
    case "Есть несколько разных ролей, значит найм не точечный":
      return "найм выглядит не точечным"
    case "Роль опубликована недавно, это хороший момент для контакта":
      return "роль опубликована недавно"
    case "Вакансия опубликована совсем недавно":
      return "вакансия опубликована совсем недавно"
    default:
      return "найм выглядит актуальным"
  }
}

function formatTimestamp(value: string | Date | null): string {
  if (!value) {
    return ""
  }

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toISOString()
}
