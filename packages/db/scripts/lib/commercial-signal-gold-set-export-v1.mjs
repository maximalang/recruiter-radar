export const GOLD_SET_EXPORT_MAX_ELIGIBLE_ROWS = 5_000

export async function loadCommercialSignalGoldSetRows(client, scope) {
  const result = await client.query(`
    SELECT
      quality.workspace_id::TEXT AS "workspaceId",
      quality.client_profile_id::TEXT AS "profileId",
      quality.organization_id::TEXT AS "organizationId",
      quality.id::TEXT AS "qualitySnapshotId",
      quality.candidate_id::TEXT AS "candidateId",
      candidate.candidate_generation AS "candidateGeneration",
      lineage.opportunity_lineage_id::TEXT AS "opportunityLineageId",
      quality.decision_at::TEXT AS "decisionAt",
      candidate.score_version AS "opportunityV3Version",
      candidate.ranking_score::DOUBLE PRECISION AS "opportunityV3Score",
      candidate.status AS "opportunityV3Status",
      0 AS "opportunityV3UnknownFeatureCount",
      quality.feature_version AS "qualityVersion",
      quality.quality_generation AS "qualityGeneration",
      quality.quality_identity AS "qualityIdentity",
      quality.quality_score::DOUBLE PRECISION AS "qualityScore",
      COALESCE(quality.feature_snapshot->>'status', 'review') AS "qualityStatus",
      quality.quality_coverage::DOUBLE PRECISION AS "qualityCoverage",
      quality.quality_confidence::DOUBLE PRECISION AS "qualityConfidence",
      COALESCE((
        SELECT COUNT(*)::INTEGER
        FROM JSONB_EACH_TEXT(COALESCE(
          quality.feature_snapshot #> '{observationStates,hiringFriction}',
          '{}'::JSONB
        )) AS observation(key, value)
        WHERE observation.value IN ('unknown', 'not_supported')
      ), 0) AS "qualityUnknownFeatureCount",
      quality.components AS "qualityComponents",
      quality.reason_codes AS "qualityReasonCodes",
      quality.feature_snapshot AS "qualityFeatureSnapshot",
      COALESCE(candidate.evidence_snapshot->'evidenceIds', '[]'::JSONB) AS "candidateEvidenceIds",
      JSONB_SET(
        JSONB_SET(
          JSONB_SET(
            candidate.feature_snapshot,
            '{evidenceSourceFamilies}',
            COALESCE(candidate.evidence_snapshot->'evidenceSourceFamilies', '[]'::JSONB),
            TRUE
          ),
          '{directEvidenceCount}',
          TO_JSONB(COALESCE((candidate.evidence_snapshot->>'directEvidenceCount')::INTEGER, 0)),
          TRUE
        ),
        '{corroborationEvidenceCount}',
        TO_JSONB(COALESCE((candidate.evidence_snapshot->>'corroborationEvidenceCount')::INTEGER, 0)),
        TRUE
      ) AS "candidateFeatureSnapshot",
      JSONB_BUILD_OBJECT(
        'targetCity', profile.target_city,
        'specialization', profile.specialization,
        'roles', profile.roles,
        'industries', profile.industries,
        'companySizes', profile.company_sizes,
        'excludedIndustries', profile.excluded_industries,
        'excludedLocations', profile.excluded_locations,
        'remoteFriendly', profile.remote_friendly,
        'hiringMode', profile.hiring_mode,
        'contactPolicy', profile.contact_policy
      ) AS "agencyProfile",
      COALESCE(evidence.rows, '[]'::JSONB) AS evidence
    FROM commercial_signal_quality_snapshots quality
    JOIN commercial_signal_quality_opportunity_lineage lineage
      ON lineage.quality_snapshot_id = quality.id
     AND lineage.candidate_id = quality.candidate_id
     AND lineage.workspace_id = quality.workspace_id
     AND lineage.client_profile_id = quality.client_profile_id
    JOIN opportunity_candidates candidate
      ON candidate.id = quality.candidate_id
     AND candidate.organization_id = quality.organization_id
     AND candidate.workspace_id = quality.workspace_id
     AND candidate.client_profile_id = quality.client_profile_id
    JOIN client_profiles profile
      ON profile.id = quality.client_profile_id
     AND profile.owner_id = candidate.owner_id
    LEFT JOIN LATERAL (
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'evidenceId', item.evidence_id::TEXT,
        'decisionRole', item.decision_role,
        'sourceKind', item.source_kind,
        'sourceFamily', item.source_family,
        'observedAt', item.observed_at::TEXT,
        'independenceGroup', item.evidence_independence_group,
        'correlationReasonCode', item.correlation_reason_code
      ) ORDER BY item.observed_at, item.evidence_id) AS rows
      FROM commercial_signal_quality_evidence item
      WHERE item.quality_snapshot_id = quality.id
        AND item.candidate_id = quality.candidate_id
        AND item.organization_id = quality.organization_id
        AND item.workspace_id = quality.workspace_id
        AND item.client_profile_id = quality.client_profile_id
        AND item.observed_at <= quality.decision_at
    ) evidence ON TRUE
    WHERE quality.workspace_id = $1::BIGINT
      AND quality.client_profile_id = $2::BIGINT
      AND quality.decision_at >= $3::TIMESTAMPTZ
      AND quality.decision_at < $4::TIMESTAMPTZ
      AND candidate.score_version = 'opportunity-v3'
      AND quality.feature_version = 'commercial-signal-quality-v2'
    ORDER BY quality.decision_at, quality.id
    LIMIT ${GOLD_SET_EXPORT_MAX_ELIGIBLE_ROWS + 1}
  `, [scope.workspaceId, scope.profileId, scope.from, scope.to])
  return result.rows
}
