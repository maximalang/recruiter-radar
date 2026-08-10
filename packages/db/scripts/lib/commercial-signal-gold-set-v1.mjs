import { createHash, createHmac } from 'node:crypto'

export const GOLD_SCHEMA = 'commercial-signal-gold-set-v1'
export const REVIEW_SCHEMA = 'commercial-signal-human-review-v1'
export const REPORT_SCHEMA = 'commercial-signal-human-quality-report-v1'
export const SAMPLING_POLICY = 'balanced-commercial-review-v1'
export const GOLD_REQUIREMENTS = Object.freeze({
  minimumReviewedSamples: 30,
  minimumAgencyProfiles: 2,
  minimumDoubleReviewedSamples: 5,
  minimumSegmentSamples: 10,
  purpose: 'operational evaluation readiness; not statistical significance or a production rollout gate',
})
export const REVIEW_LABELS = ['strong', 'acceptable', 'weak']
export const FALSE_POSITIVE_CATEGORIES = [
  'ordinary_hiring','evergreen_hiring','correlated_republication','stale_signal',
  'commercial_mismatch','policy_blocked','unknown',
]
export const FALSE_NEGATIVE_CATEGORIES = [
  'coverage_gap','source_gap','friction_underestimated','agency_fit_underestimated',
  'propensity_underestimated','timing_decay_too_aggressive',
  'negative_evidence_false_block','contact_path_missing','unknown',
]
const STATUS = ['qualified_actionable','qualified_needs_enrichment','review','blocked','expired','dismissed']
const BUCKETS = ['top_baseline','quality_promotion','quality_demotion','negative_state_blocked','borderline','missed_opportunity','random_control']
const DEFAULT_QUOTAS = { top_baseline:6, quality_promotion:5, quality_demotion:5, negative_state_blocked:4, borderline:5, missed_opportunity:5, random_control:5 }
const FORBIDDEN_KEY = /(^|_)(email|phone|telegram|token|secret|password|cookie|authorization|person|full_name|contact_name)($|_)/i
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i

export function buildGoldSetDataset(rawRows, options = {}) {
  const workspaceId = positiveId(options.workspaceId, 'workspace id')
  const profileId = positiveId(options.profileId, 'profile id')
  const datasetVersion = version(options.datasetVersion)
  const seed = text(options.seed, 'sampling seed', 128)
  const key = secret(options.anonymizationKey)
  const from = timestamp(options.from, 'from')
  const to = timestamp(options.to, 'to')
  if (Date.parse(to) <= Date.parse(from)) fail('to must be later than from')
  if ((options.samplingPolicy ?? SAMPLING_POLICY) !== SAMPLING_POLICY) fail('unsupported sampling policy')
  const normalized = rawRows.map((row) => normalizeRawRow(row, { workspaceId, profileId, key, from, to }))
  unique(normalized.map((row) => row.sampleId), 'sample id')
  const ranked = rankRows(normalized)
  const classified = ranked.map((row) => ({ ...row, samplingBuckets: classify(row) }))
  const quotas = normalizeQuotas(options.bucketQuotas ?? DEFAULT_QUOTAS)
  const selected = deterministicSample(classified, quotas, seed)
  selected.sort((a,b) => compare(hash(`${seed}:${a.sampleId}`), hash(`${seed}:${b.sampleId}`)))
  const frozenFingerprint = fingerprint(selected)
  const dataset = {
    manifest: {
      recordType: 'manifest', schemaVersion: GOLD_SCHEMA, datasetVersion,
      datasetRevision: 1, labelRevision: 0, samplingPolicy: SAMPLING_POLICY,
      samplingSeedHash: hash(seed), workspaceKey: hmac(key, `workspace:${workspaceId}`),
      agencyProfileKey: hmac(key, `profile:${profileId}`), timeWindow: { from, to },
      reviewMode: 'model_blind', provenance: 'anonymized_real_candidate_export',
      status: 'READY_FOR_HUMAN_LABELING', requirements: GOLD_REQUIREMENTS,
      bucketQuotas: quotas, eligibleCount: classified.length, sampleCount: selected.length,
      bucketPopulation: countBuckets(classified), bucketSelected: countBuckets(selected),
      frozenFingerprint, createdAt: timestamp(options.createdAt ?? to, 'created at'),
      claims: { contractTested:false, readyForHumanLabeling:true, humanReviewed:false, qualityValidated:false },
    },
    rows: selected,
  }
  assertNoPii(buildBlindReviewPackage(dataset))
  return dataset
}

export function buildBlindReviewPackage(dataset) {
  validateDataset(dataset)
  const result = {
    schemaVersion: REVIEW_SCHEMA, datasetVersion: dataset.manifest.datasetVersion,
    reviewMode: 'model_blind',
    instructions: [
      'Review agency fit, why-now facts, evidence dates and provenance before assigning labels.',
      'Model score, rank, status, ranking delta and sampling bucket are deliberately hidden.',
      'Quality Engine output must never be treated as a human label or second reviewer.',
    ],
    rows: dataset.rows.map((row) => ({
      sampleId: row.sampleId, agencyProfileId: row.agencyProfileId,
      companyId: row.companyId, decisionAt: row.decisionAt,
      agencyProfile: clone(row.agencyProfile), facts: clone(row.facts),
      evidence: clone(row.evidence),
    })),
  }
  assertNoPii(result)
  return result
}

export function applyHumanReviews(dataset, reviews, options = {}) {
  validateDataset(dataset)
  if (!Array.isArray(reviews) || reviews.length === 0) fail('human review records are required')
  if (fingerprint(dataset.rows) !== dataset.manifest.frozenFingerprint) fail('frozen dataset fingerprint mismatch')
  const byId = new Map(dataset.rows.map((row) => [row.sampleId, clone(row)]))
  for (const raw of reviews) {
    const review = normalizeReview(raw, dataset, options.importedAt)
    const row = byId.get(review.sampleId)
    if (!row) fail(`unknown sample id: ${review.sampleId}`)
    row.reviews ??= []
    const prior = row.reviews.filter((item) => item.reviewerId === review.reviewerId)
    const expected = prior.length ? Math.max(...prior.map((item) => item.revision)) + 1 : 1
    if (review.revision !== expected) fail(`review revision for ${review.sampleId}/${review.reviewerId} must be ${expected}`)
    if (review.revision > 1 && !review.revisionReason) fail('review correction requires revision reason')
    row.reviews.push(review)
  }
  const rows = dataset.rows.map((row) => byId.get(row.sampleId))
  const states = rows.map(resolveGoldReviewState)
  const humanReviewed = states.some((state) => state.finalReview !== null)
  const status = reviewStatus(states, new Set(rows.map((row) => row.agencyProfileId)).size)
  const output = {
    manifest: {
      ...clone(dataset.manifest), datasetRevision: dataset.manifest.datasetRevision + 1,
      labelRevision: dataset.manifest.labelRevision + 1, status,
      claims: { ...dataset.manifest.claims, humanReviewed, qualityValidated:false },
      reviewedAt: timestamp(options.importedAt ?? new Date().toISOString(), 'imported at'),
    },
    rows,
  }
  if (fingerprint(output.rows) !== dataset.manifest.frozenFingerprint) fail('review import mutated frozen model/evidence rows')
  return output
}

export function resolveGoldReviewState(row) {
  const reviews = Array.isArray(row.reviews) ? row.reviews : []
  const latest = [...new Set(reviews.map((item) => item.reviewerId))].map((reviewerId) =>
    reviews.filter((item) => item.reviewerId === reviewerId).sort((a,b) => b.revision - a.revision)[0])
  const adjudications = latest.filter((item) => item.adjudication)
  if (adjudications.length > 1) fail(`multiple active adjudications for ${row.sampleId}`)
  if (adjudications.length === 1) return { latest, disagreement:false, finalReview:adjudications[0], resolution:'adjudicated' }
  if (latest.length === 0) return { latest, disagreement:false, finalReview:null, resolution:'unreviewed' }
  if (latest.length === 1) return { latest, disagreement:false, finalReview:latest[0], resolution:'single_review' }
  const keys = new Set(latest.map((item) => `${item.reviewLabel}:${item.actionable}`))
  if (keys.size === 1) return { latest, disagreement:false, finalReview:latest[0], resolution:'consensus' }
  return { latest, disagreement:true, finalReview:null, resolution:'needs_adjudication' }
}

export function toEvaluationV2Rows(dataset) {
  validateDataset(dataset)
  return dataset.rows.map((row) => {
    const final = resolveGoldReviewState(row).finalReview
    const changed = row.model.quality.status !== row.model.opportunityV3.status
    return {
      sampleKey: row.sampleId, agencyProfileKey: row.agencyProfileId,
      decisionAt: row.decisionAt,
      modelLineage: {
        opportunity_v3: numericLineage(row),
        quality_engine_v2: numericLineage(row),
      },
      scores: { freshness:null, vacancy_volume:null, fiur:null, opportunity_v2:null,
        opportunity_v3:row.model.opportunityV3.score,
        quality_engine_v2:row.model.quality.score },
      qualityCoverage: row.model.quality.coverage,
      previousQualityCoverage: row.model.opportunityV3.agencyFitCoverage,
      unknownFeatureCount: row.model.quality.unknownFeatureCount,
      previousUnknownFeatureCount: row.model.opportunityV3.unknownFeatureCount,
      qualityConfidence: row.model.quality.confidence,
      reviewLabel: final?.reviewLabel ?? null,
      status: row.model.quality.status, previousStatus: row.model.opportunityV3.status,
      rankingChangeReasons: changed ? rankingReasons(row.model.quality.reasonCodes) : [],
      blockedByNegativeState: row.model.quality.blockedByNegativeState,
      friction: row.model.quality.friction, agencyFit: row.model.quality.agencyFit,
      propensity: row.model.quality.propensity, convergence: row.model.quality.convergence,
      outcomeProjection: null,
      falsePositiveCategory: final?.falsePositiveCategory ?? null,
      falseNegativeCategory: final?.falseNegativeCategory ?? null,
      evidenceObservedAt: row.evidence.map((item) => item.observedAt),
    }
  })
}

export function summarizeReviews(datasets) {
  const rows = datasets.flatMap((dataset) => dataset.rows)
  const states = rows.map(resolveGoldReviewState)
  const finals = states.map((state) => state.finalReview).filter(Boolean)
  const profileCount = new Set(rows.map((row) => row.agencyProfileId)).size
  const doubleReviewed = states.filter((state) => state.latest.length >= 2).length
  const disagreements = states.filter((state) => state.disagreement).length
  const reviewed = finals.length
  const operationalStatus = reviewed === 0 ? 'review_in_progress' :
    reviewed >= GOLD_REQUIREMENTS.minimumReviewedSamples &&
    profileCount >= GOLD_REQUIREMENTS.minimumAgencyProfiles &&
    doubleReviewed >= GOLD_REQUIREMENTS.minimumDoubleReviewedSamples &&
    disagreements === 0 ? 'evaluation_ready' : 'insufficient_data'
  return {
    sampleCount: rows.length, reviewedCount: reviewed, agencyProfileCount: profileCount,
    doubleReviewedCount: doubleReviewed, disagreementCount: disagreements,
    agreementRate: doubleReviewed ? Math.round((doubleReviewed-disagreements)/doubleReviewed*10000)/10000 : null,
    operationalStatus, qualityValidated:false,
    actionableRate: rate(finals, (item) => item.actionable),
    evidenceCompleteRate: rate(finals, (item) => item.evidenceCompleteness === 'complete'),
    corroboratedRate: rate(finals, (item) => item.independentCorroboration === 'confirmed'),
    directHiringProofRate: rate(finals, (item) => item.directHiringProof === 'confirmed'),
  }
}

export function buildSegments(datasets) {
  const rows = datasets.flatMap((dataset) => dataset.rows)
  const segments = []
  const add = (dimension, keyOf) => {
    const groups = new Map()
    for (const row of rows) {
      for (const key of keyOf(row)) groups.set(key, [...(groups.get(key) ?? []), row])
    }
    for (const [key, group] of groups) {
      const reviewed = group.map(resolveGoldReviewState).filter((state) => state.finalReview).length
      segments.push({ dimension, key, sampleCount:group.length, reviewedCount:reviewed,
        status: reviewed >= GOLD_REQUIREMENTS.minimumSegmentSamples ? 'available' : 'insufficient_data' })
    }
  }
  add('agency_profile', (row) => [row.agencyProfileId])
  add('source_family', (row) => [...new Set(row.evidence.map((item) => item.sourceFamily))])
  return { segments, unsupportedDimensions: ['industry','role_family','region','company_type'],
    unsupportedReason: 'current exact frozen lineage does not expose a canonical company-level dimension safely enough for segment claims' }
}

export function renderReviewCsv(reviewPackage) {
  const head = ['sample_id','decision_at','agency_profile','facts','evidence']
  return [head, ...reviewPackage.rows.map((row) => [row.sampleId,row.decisionAt,
    JSON.stringify(row.agencyProfile),JSON.stringify(row.facts),JSON.stringify(row.evidence)])]
    .map(csvRow).join('\n') + '\n'
}

export function renderLabelTemplateCsv(reviewPackage) {
  const head = ['sample_id','reviewer_id','revision','review_label','actionable','agency_dna_fit','external_support_need','evidence_completeness','evidence_freshness','independent_corroboration','direct_hiring_proof','negative_evidence','observation_support','provenance_status','reviewer_confidence','false_positive_category','false_negative_category','reviewed_at','revision_reason','adjudication']
  return [head, ...reviewPackage.rows.map((row) => {
    const output=Array(head.length).fill('')
    output[0]=row.sampleId; output[2]='1'; output[19]='false'
    return output
  })].map(csvRow).join('\n') + '\n'
}

export function renderReviewHtml(reviewPackage) {
  const sections = reviewPackage.rows.map((row) => `<article><h2>${escape(row.sampleId)}</h2><p><b>Decision:</b> ${escape(row.decisionAt)}</p><p><b>Company:</b> ${escape(row.companyId)}</p><h3>Agency</h3><pre>${escape(JSON.stringify(row.agencyProfile,null,2))}</pre><h3>Facts</h3><pre>${escape(JSON.stringify(row.facts,null,2))}</pre><h3>Evidence</h3><pre>${escape(JSON.stringify(row.evidence,null,2))}</pre></article>`).join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Recruiter Radar blind review</title><style>body{font:15px system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#171717}article{border-top:1px solid #ccc;padding:28px 0}pre{white-space:pre-wrap;background:#f5f5f5;padding:14px;border-radius:8px}code{font-family:ui-monospace}</style></head><body><h1>Recruiter Radar — blind human review</h1><p>Scores, ranks, statuses and sampling buckets are intentionally hidden. Fill <code>labels.csv</code> separately.</p>${sections}</body></html>`
}

export function serializeDatasetJsonl(dataset) {
  validateDataset(dataset)
  return [dataset.manifest, ...dataset.rows.map((row) => ({ recordType:'sample', ...row }))]
    .map((row) => JSON.stringify(row)).join('\n') + '\n'
}

export function parseDatasetJsonl(value) {
  const lines = String(value).split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 1) fail('dataset JSONL is empty')
  const manifest = JSON.parse(lines[0])
  const rows = lines.slice(1).map((line) => {
    const row = JSON.parse(line); delete row.recordType; return row
  })
  const dataset = { manifest, rows }
  validateDataset(dataset)
  return dataset
}

export function parseReviewCsv(value) {
  const rows = parseCsv(value)
  if (!rows.length) return []
  const head = rows[0].map((item) => item.trim())
  return rows.slice(1)
    .map((row) => Object.fromEntries(head.map((key,index) => [key,row[index] ?? ''])))
    .filter((row) => row.reviewer_id || row.review_label)
    .map((row) => ({
      sampleId:row.sample_id, reviewerId:row.reviewer_id,
      revision:Number(row.revision || 1), reviewLabel:row.review_label,
      actionable:parseBool(row.actionable), agencyDnaFit:row.agency_dna_fit,
      externalSupportNeed:row.external_support_need,
      evidenceCompleteness:row.evidence_completeness,
      evidenceFreshness:row.evidence_freshness,
      independentCorroboration:row.independent_corroboration,
      directHiringProof:row.direct_hiring_proof,
      negativeEvidence:row.negative_evidence,
      observationSupport:row.observation_support,
      provenanceStatus:row.provenance_status,
      reviewerConfidence:row.reviewer_confidence,
      falsePositiveCategory:emptyNull(row.false_positive_category),
      falseNegativeCategory:emptyNull(row.false_negative_category),
      reviewedAt:row.reviewed_at, revisionReason:emptyNull(row.revision_reason),
      adjudication:parseBool(row.adjudication || 'false'),
    }))
}

export function assertNoPii(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((item,index) => assertNoPii(item, `${path}[${index}]`))
  if (value && typeof value === 'object') {
    for (const [key,item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) fail(`forbidden PII field at ${path}.${key}`)
      assertNoPii(item, `${path}.${key}`)
    }
    return
  }
  if (typeof value === 'string' && !/^[a-f0-9]{64}$/i.test(value) &&
      (EMAIL.test(value) || looksLikePhone(value))) fail(`PII-looking value at ${path}`)
}

function normalizeRawRow(row, scope) {
  if (positiveId(row.workspaceId,'row workspace id') !== scope.workspaceId ||
      positiveId(row.profileId,'row profile id') !== scope.profileId) {
    fail('row is outside requested tenant/profile scope')
  }
  const decisionAt = timestamp(row.decisionAt,'decision at')
  if (decisionAt < scope.from || decisionAt >= scope.to) fail('row is outside requested time window')
  const organizationId = positiveId(row.organizationId,'organization id')
  const candidateId = positiveId(row.candidateId,'candidate id')
  const candidateGeneration = positiveInt(row.candidateGeneration,'candidate generation')
  const opportunityLineageId = positiveId(row.opportunityLineageId,'opportunity lineage id')
  const qualitySnapshotId = positiveId(row.qualitySnapshotId,'quality snapshot id')
  const rawCandidateEvidenceIds = stringIdArray(row.candidateEvidenceIds, 'candidate evidence ids')
  const rawQualityEvidenceIds = stringIdArray(row.evidence?.map((item) => item.evidenceId), 'quality evidence ids')
  if (JSON.stringify(rawCandidateEvidenceIds) !== JSON.stringify(rawQualityEvidenceIds)) {
    fail('Opportunity v3 and Quality v2 must share the exact evidence universe')
  }
  const evidence = normalizeEvidence(row.evidence, decisionAt, scope.key)
  const sampleId = hmac(scope.key, `sample:${scope.workspaceId}:${scope.profileId}:${organizationId}:${candidateId}:${candidateGeneration}:${opportunityLineageId}:${qualitySnapshotId}`)
  return {
    sampleId, agencyProfileId:hmac(scope.key,`profile:${scope.profileId}`),
    companyId:hmac(scope.key,`organization:${organizationId}`), decisionAt,
    lineage: {
      candidateId:hmac(scope.key,`candidate:${candidateId}`), candidateGeneration,
      opportunityLineageId:hmac(scope.key,`lineage:${opportunityLineageId}`),
      qualitySnapshotId:hmac(scope.key,`quality:${qualitySnapshotId}`),
    },
    agencyProfile: normalizeAgencyProfile(row.agencyProfile),
    facts: normalizeFacts(row.candidateFeatureSnapshot,row.qualityFeatureSnapshot),
    evidence,
    model: {
      opportunityV3: {
        version:identifier(row.opportunityV3Version),
        score:finite(row.opportunityV3Score,'v3 score'),
        status:enumValue(row.opportunityV3Status,STATUS,'v3 status'),
        agencyFitCoverage:unit(row.candidateFeatureSnapshot?.quality?.agencyFitCoverage ?? 0,'v3 agency fit coverage'),
        unknownFeatureCount:nonNegative(row.opportunityV3UnknownFeatureCount ?? 0,'v3 unknown feature count'),
      },
      quality: {
        version:identifier(row.qualityVersion),
        generation:positiveInt(row.qualityGeneration,'quality generation'),
        identity:text(row.qualityIdentity,'quality identity',128),
        score:unit(row.qualityScore,'quality score'),
        status:enumValue(row.qualityStatus,STATUS,'quality status'),
        coverage:unit(row.qualityCoverage,'quality coverage'),
        confidence:unit(row.qualityConfidence,'quality confidence'),
        friction:unit(row.qualityFriction ?? componentValue(row.qualityComponents,'hiring_friction'), 'friction'),
        agencyFit:unit(row.qualityAgencyFit ?? componentValue(row.qualityComponents,'agency_fit'), 'agency fit'),
        propensity:unit(row.qualityPropensity ?? componentValue(row.qualityComponents,'external_agency_propensity'), 'propensity'),
        convergence:optionalUnit(row.qualityConvergence ?? componentValue(row.qualityComponents,'signal_convergence')),
        unknownFeatureCount:nonNegative(row.qualityUnknownFeatureCount ?? countUnknown(row.qualityFeatureSnapshot), 'quality unknown feature count'),
        reasonCodes:stringArray(row.qualityReasonCodes),
        blockedByNegativeState:isNegativeBlocked(row),
      },
    },
    reviews: [],
  }
}

function normalizeEvidence(value, decisionAt, key) {
  if (!Array.isArray(value) || value.length === 0) fail('exact evidence lineage is required')
  const result = value.map((item) => {
    const observedAt = timestamp(item.observedAt,'evidence observed at')
    if (observedAt > decisionAt) fail('future evidence cannot enter gold set')
    return {
      evidenceId:hmac(key,`evidence:${positiveId(item.evidenceId,'evidence id')}`),
      decisionRole:enumValue(item.decisionRole,['positive','negative','contact_policy'],'decision role'),
      sourceKind:enumValue(item.sourceKind,['direct','official','approved_context','derived_deterministic'],'source kind'),
      sourceFamily:identifier(item.sourceFamily), sourceDomain:safeDomain(item.sourceDomain),
      observedAt,
      independenceGroup:hmac(key,`group:${text(item.independenceGroup,'independence group',256)}`),
      correlationReasonCode:identifier(item.correlationReasonCode),
      canonicalUrl:safeUrl(item.canonicalUrl),
    }
  }).sort((a,b) => compare(`${a.observedAt}:${a.evidenceId}`,`${b.observedAt}:${b.evidenceId}`))
  unique(result.map((item) => item.evidenceId),'evidence id')
  return result
}

function normalizeAgencyProfile(input = {}) {
  const result = {
    targetCity:optionalText(input.targetCity,128),
    specialization:optionalText(input.specialization,256),
    roles:stringArray(input.roles), industries:stringArray(input.industries),
    companySizes:stringArray(input.companySizes),
    excludedIndustries:stringArray(input.excludedIndustries),
    excludedLocations:stringArray(input.excludedLocations),
    remoteFriendly:Boolean(input.remoteFriendly),
    hiringMode:identifier(input.hiringMode ?? 'auto'),
    contactPolicy:identifier(input.contactPolicy ?? 'corporate_only'),
  }
  assertNoPii(result)
  return result
}

function normalizeFacts(candidate = {}, quality = {}) {
  const q = candidate?.quality ?? {}; const a = candidate?.actionability ?? {}
  const result = {
    episodeStage:identifier(q.episodeStage ?? 'unknown'),
    episodeLastSeenAt:optionalTimestamp(q.episodeLastSeenAt),
    organizationIdentityVerified:Boolean(q.organizationIdentityVerified),
    stateChangeConfirmed:Boolean(q.stateChangeConfirmed),
    evidenceSourceFamilies:stringArray(candidate?.evidenceSourceFamilies),
    directEvidenceCount:nonNegative(candidate?.directEvidenceCount ?? 0,'direct evidence count'),
    corroborationEvidenceCount:nonNegative(candidate?.corroborationEvidenceCount ?? 0,'corroboration count'),
    corporateContactPathCategories:stringArray(a.corporateContactPathCategories),
    qualityObservationStates:quality?.observationStates ?? {},
  }
  assertNoPii(result)
  return result
}

function normalizeReview(raw, dataset, importedAt) {
  const sampleId = text(raw.sampleId,'sample id',128)
  const reviewerId=identifier(raw.reviewerId)
  if (/^(model|quality|gpt|llm|openai)(:|-|$)/i.test(reviewerId)) {
    fail('model output cannot be registered as a human reviewer')
  }
  const review = {
    schemaVersion: REVIEW_SCHEMA, sampleId, reviewerId,
    revision:positiveInt(raw.revision ?? 1,'review revision'),
    reviewLabel:enumValue(raw.reviewLabel,REVIEW_LABELS,'review label'),
    actionable:boolean(raw.actionable,'actionable'),
    agencyDnaFit:enumValue(raw.agencyDnaFit,['fit','partial','mismatch','unknown'],'agency DNA fit'),
    externalSupportNeed:enumValue(raw.externalSupportNeed,['high','medium','low','unknown'],'external support need'),
    evidenceCompleteness:enumValue(raw.evidenceCompleteness,['complete','partial','insufficient','unknown'],'evidence completeness'),
    evidenceFreshness:enumValue(raw.evidenceFreshness,['fresh','borderline','stale','unknown'],'evidence freshness'),
    independentCorroboration:enumValue(raw.independentCorroboration,['confirmed','single_source','correlated','unknown'],'independent corroboration'),
    directHiringProof:enumValue(raw.directHiringProof,['confirmed','absent','unknown'],'direct hiring proof'),
    negativeEvidence:enumValue(raw.negativeEvidence,['present','absent','unknown'],'negative evidence'),
    observationSupport:enumValue(raw.observationSupport,['observed','unknown','not_supported'],'observation support'),
    provenanceStatus:enumValue(raw.provenanceStatus,['verified','partial','unverified'],'provenance status'),
    reviewerConfidence:enumValue(raw.reviewerConfidence,['high','medium','low'],'reviewer confidence'),
    falsePositiveCategory:raw.falsePositiveCategory == null ? null :
      enumValue(raw.falsePositiveCategory,FALSE_POSITIVE_CATEGORIES,'false positive category'),
    falseNegativeCategory:raw.falseNegativeCategory == null ? null :
      enumValue(raw.falseNegativeCategory,FALSE_NEGATIVE_CATEGORIES,'false negative category'),
    reviewedAt:timestamp(raw.reviewedAt || importedAt || new Date().toISOString(),'reviewed at'),
    revisionReason:raw.revisionReason == null ? null : text(raw.revisionReason,'revision reason',500),
    adjudication:Boolean(raw.adjudication),
  }
  if (!dataset.rows.some((row) => row.sampleId === sampleId)) fail(`unknown sample id: ${sampleId}`)
  assertNoPii(review)
  return review
}

function rankRows(rows) {
  const v3 = new Map([...rows]
    .sort((a,b) => b.model.opportunityV3.score-a.model.opportunityV3.score || compare(a.sampleId,b.sampleId))
    .map((row,index) => [row.sampleId,index+1]))
  const quality = new Map([...rows]
    .sort((a,b) => b.model.quality.score-a.model.quality.score || compare(a.sampleId,b.sampleId))
    .map((row,index) => [row.sampleId,index+1]))
  return rows.map((row) => ({ ...row, model:{ ...row.model,
    opportunityV3:{...row.model.opportunityV3,rank:v3.get(row.sampleId)},
    quality:{...row.model.quality,rank:quality.get(row.sampleId)} } }))
}

function classify(row) {
  const buckets = []
  if (row.model.opportunityV3.rank <= 10) buckets.push('top_baseline')
  if (row.model.quality.rank < row.model.opportunityV3.rank) buckets.push('quality_promotion')
  if (row.model.quality.rank > row.model.opportunityV3.rank) buckets.push('quality_demotion')
  if (row.model.quality.blockedByNegativeState) buckets.push('negative_state_blocked')
  if (Math.abs(row.model.quality.score - 0.68) <= 0.05) buckets.push('borderline')
  if (row.model.opportunityV3.rank > 10 && row.model.quality.rank > 10) buckets.push('missed_opportunity')
  buckets.push('random_control')
  return buckets
}

function deterministicSample(rows, quotas, seed) {
  const selected = new Map()
  for (const bucket of BUCKETS) {
    const candidates = rows.filter((row) => row.samplingBuckets.includes(bucket))
      .sort((a,b) => compare(hash(`${seed}:${bucket}:${a.sampleId}`),hash(`${seed}:${bucket}:${b.sampleId}`)))
    for (const row of candidates.slice(0,quotas[bucket])) selected.set(row.sampleId,row)
  }
  return [...selected.values()]
}

function countBuckets(rows) {
  return Object.fromEntries(BUCKETS.map((bucket) =>
    [bucket,rows.filter((row) => row.samplingBuckets.includes(bucket)).length]))
}
function normalizeQuotas(input) {
  return Object.fromEntries(BUCKETS.map((bucket) =>
    [bucket,positiveInt(input[bucket] ?? DEFAULT_QUOTAS[bucket],`${bucket} quota`)]))
}
function reviewStatus(states, profiles) {
  const finals=states.filter((state)=>state.finalReview)
  const doubled=states.filter((state)=>state.latest.length>=2)
  const disagreements=states.filter((state)=>state.disagreement)
  if (!finals.length) return 'READY_FOR_HUMAN_LABELING'
  return finals.length>=GOLD_REQUIREMENTS.minimumReviewedSamples &&
    profiles>=GOLD_REQUIREMENTS.minimumAgencyProfiles &&
    doubled.length>=GOLD_REQUIREMENTS.minimumDoubleReviewedSamples &&
    disagreements.length===0 ? 'EVALUATION_READY' : 'HUMAN_REVIEW_IN_PROGRESS'
}

function validateDataset(dataset) {
  if (dataset?.manifest?.schemaVersion !== GOLD_SCHEMA || !Array.isArray(dataset?.rows)) {
    fail('invalid gold-set dataset')
  }
  unique(dataset.rows.map((row)=>row.sampleId),'sample id')
  if (fingerprint(dataset.rows) !== dataset.manifest.frozenFingerprint) {
    fail('frozen dataset fingerprint mismatch')
  }
}
function fingerprint(rows) {
  return hash(JSON.stringify(rows.map((row) => ({
    sampleId:row.sampleId,companyId:row.companyId,decisionAt:row.decisionAt,
    lineage:row.lineage,agencyProfile:row.agencyProfile,facts:row.facts,
    evidence:row.evidence,model:row.model,samplingBuckets:row.samplingBuckets,
  })).sort((a,b)=>compare(a.sampleId,b.sampleId))))
}
function numericLineage(row) {
  const base=(value)=>String((BigInt(`0x${hash(`lineage:${value}`).slice(0,15)}`)%9000000000000000000n)+1n)
  return { candidateId:base(row.lineage.candidateId),
    candidateGeneration:row.lineage.candidateGeneration,
    opportunityLineageId:base(row.lineage.opportunityLineageId) }
}
function rankingReasons(codes) {
  const out=[]; const value=codes.join(' ').toLowerCase()
  if (value.includes('repost')) out.push('repost')
  if (value.includes('lifetime')) out.push('lifetime')
  if (value.includes('senior')) out.push('seniority')
  if (value.includes('slow')) out.push('slowdown')
  if (value.includes('recruit')) out.push('recruiter_pressure')
  if (value.includes('role')) out.push('role_mix')
  return out.length?out:['baseline']
}
function isNegativeBlocked(row) {
  return row.qualityStatus === 'blocked' ||
    stringArray(row.qualityReasonCodes).some((code)=>/NEGATIVE|DNC|CONFLICT|BLOCK/i.test(code))
}
function componentValue(components,key) {
  const value=components?.[key]?.value
  return value == null ? 0 : Number(value)
}
function countUnknown(snapshot) {
  const states=snapshot?.observationStates
  if (!states || typeof states!=='object') return 0
  return Object.values(states).filter((value)=>value==='unknown'||value==='not_supported').length
}
function stringIdArray(value,label) {
  if(!Array.isArray(value)||!value.length) fail(`${label} are required`)
  return [...new Set(value.map((item)=>positiveId(item,label)))]
    .sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0)
}
function looksLikePhone(value) {
  const matches=String(value).match(/\+?\d[\d\s().-]{8,}\d/g) ?? []
  return matches.some((item)=>item.replace(/\D/g,'').length>=10)
}
function safeUrl(value) {
  if (!value) return null
  try {
    const url=new URL(String(value))
    if (!['http:','https:'].includes(url.protocol)) return null
    url.username='';url.password='';url.search='';url.hash=''
    const result=url.toString()
    if (EMAIL.test(result)||looksLikePhone(result)) return null
    return result
  } catch { return null }
}
function safeDomain(value) {
  const result=String(value??'').trim().toLowerCase()
  return /^[a-z0-9.-]{1,253}$/.test(result)?result:'unknown'
}
function stringArray(value) {
  return Array.isArray(value)?[...new Set(value.map((item)=>String(item).trim().toLowerCase()).filter(Boolean))].sort():[]
}
function identifier(value) {
  const result=String(value??'').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(result)) fail(`invalid identifier: ${value}`)
  return result
}
function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} is invalid`)
  return value
}
function optionalText(value,max) {
  if (value==null||value==='') return null
  const result=String(value).trim().slice(0,max)
  if (EMAIL.test(result)||looksLikePhone(result)) fail('PII-like profile text is forbidden')
  return result
}
function optionalTimestamp(value) { return value?timestamp(value,'timestamp'):null }
function optionalUnit(value) { return value==null?null:unit(value,'unit value') }
function unit(value,label) {
  const n=Number(value); if (!Number.isFinite(n)||n<0||n>1) fail(`${label} must be within 0..1`); return n
}
function finite(value,label) {
  const n=Number(value); if (!Number.isFinite(n)) fail(`${label} must be finite`); return n
}
function nonNegative(value,label) {
  const n=Number(value); if (!Number.isSafeInteger(n)||n<0) fail(`${label} must be a non-negative integer`); return n
}
function positiveInt(value,label) {
  const n=Number(value); if (!Number.isSafeInteger(n)||n<=0) fail(`${label} must be a positive integer`); return n
}
function positiveId(value,label) {
  const result=String(value??'').trim()
  if (!/^[1-9]\d{0,18}$/.test(result)||BigInt(result)>9223372036854775807n) fail(`${label} is invalid`)
  return BigInt(result).toString()
}
function boolean(value,label) {
  if (typeof value!=='boolean') fail(`${label} must be boolean`)
  return value
}
function parseBool(value) {
  if (value===true||String(value).toLowerCase()==='true') return true
  if (value===false||String(value).toLowerCase()==='false') return false
  return null
}
function timestamp(value,label) {
  const parsed=Date.parse(String(value??'')); if (!Number.isFinite(parsed)) fail(`${label} is invalid`)
  return new Date(parsed).toISOString()
}
function version(value) {
  const result=text(value,'dataset version',100)
  if (!/^[a-z0-9][a-z0-9._-]+$/i.test(result)) fail('dataset version is invalid')
  return result
}
function text(value,label,max) {
  const result=String(value??'').trim(); if (!result||result.length>max) fail(`${label} is invalid`); return result
}
function secret(value) {
  const result=String(value??''); if (result.length<32) fail('anonymization key must contain at least 32 characters'); return result
}
function hmac(key,value) { return createHmac('sha256',key).update(value).digest('hex') }
function hash(value) { return createHash('sha256').update(String(value)).digest('hex') }
function unique(values,label) { if (new Set(values).size!==values.length) fail(`duplicate ${label}`) }
function clone(value) { return structuredClone(value) }
function compare(a,b) { return String(a).localeCompare(String(b)) }
function rate(rows,predicate) { return rows.length?Math.round(rows.filter(predicate).length/rows.length*10000)/10000:null }
function emptyNull(value) { const result=String(value??'').trim(); return result||null }
function csvRow(row) { return row.map((value)=>`"${String(value??'').replaceAll('"','""')}"`).join(',') }
function parseCsv(value) {
  const out=[];let row=[];let field='';let quoted=false;const input=String(value)
  for(let i=0;i<input.length;i++){
    const c=input[i]
    if(quoted){
      if(c==='"'&&input[i+1]==='"'){field+='"';i++}
      else if(c==='"')quoted=false
      else field+=c
    } else if(c==='"')quoted=true
    else if(c===','){row.push(field);field=''}
    else if(c==='\n'){row.push(field);out.push(row);row=[];field=''}
    else if(c!=='\r')field+=c
  }
  if(field||row.length){row.push(field);out.push(row)}
  return out
}
function escape(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
}
function fail(message) { throw new TypeError(message) }
