import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'

export type EvidenceRadarRegionBoundary = {
  code: string
  name: string
  centerLatitude: number
  centerLongitude: number
  geometry: Readonly<Record<string, unknown>>
  canonicalUrl: string
  confidence: number
}

type EvidenceRadarDb = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

export async function listEvidenceRadarRegionBoundaries(
  db: EvidenceRadarDb | null = getPool(),
): Promise<EvidenceRadarRegionBoundary[]> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const result = await db.query<{
    code: string
    name: string
    centerLatitude: number
    centerLongitude: number
    geometry: Readonly<Record<string, unknown>>
    canonicalUrl: string
    confidence: number
  }>(
    `SELECT
       federal_subject_code AS code,
       federal_subject_name AS name,
       center_latitude::DOUBLE PRECISION AS "centerLatitude",
       center_longitude::DOUBLE PRECISION AS "centerLongitude",
       geometry_geojson AS geometry,
       canonical_url AS "canonicalUrl",
       confidence::DOUBLE PRECISION AS confidence
     FROM federal_subject_geometries_v1
     WHERE verification_status = 'verified'
     ORDER BY federal_subject_code`,
  )
  return result.rows.map((row) => ({
    code: row.code,
    name: row.name,
    centerLatitude: Number(row.centerLatitude),
    centerLongitude: Number(row.centerLongitude),
    geometry: row.geometry,
    canonicalUrl: row.canonicalUrl,
    confidence: Number(row.confidence),
  }))
}
