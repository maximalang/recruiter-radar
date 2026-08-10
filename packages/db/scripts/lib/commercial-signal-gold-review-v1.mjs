import { createHash } from 'node:crypto'

import { buildBlindReviewPackage } from './commercial-signal-gold-set-v1.mjs'

export function buildStrictBlindReviewPackage(dataset) {
  const base = buildBlindReviewPackage(dataset)
  return {
    ...base,
    rows: base.rows.map((row) => {
      const facts = { ...row.facts }
      const observationStates = facts.qualityObservationStates ?? {}
      delete facts.qualityObservationStates
      const latestEvidenceAt = row.evidence
        .map((item) => item.observedAt)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null
      return {
        ...row,
        facts: {
          ...facts,
          observationStates,
          whyNowFacts: {
            episodeStage: facts.episodeStage ?? null,
            episodeLastSeenAt: facts.episodeLastSeenAt ?? null,
            latestEvidenceAt,
            evidenceSourceFamilies: facts.evidenceSourceFamilies ?? [],
            directEvidenceCount: facts.directEvidenceCount ?? 0,
            corroborationEvidenceCount: facts.corroborationEvidenceCount ?? 0,
          },
        },
        evidence: row.evidence.map((item) => {
          const {
            canonicalUrl: _canonicalUrl,
            sourceDomain: _sourceDomain,
            ...reviewSafe
          } = item
          return reviewSafe
        }),
      }
    }),
  }
}

export function summarizeIndependentReviewerAgreement(datasets) {
  const rows = datasets.flatMap((dataset) => dataset.rows)
  const states = rows.map(independentReviewState)
  const doubleReviewed = states.filter((state) => state.independentReviewCount >= 2)
  const disagreements = doubleReviewed.filter((state) => state.disagreement)
  const unresolved = disagreements.filter((state) => !state.adjudicated)
  const invalidAdjudications = states.filter((state) => state.invalidAdjudication)
  return {
    doubleReviewedCount: doubleReviewed.length,
    agreementCount: doubleReviewed.length - disagreements.length,
    disagreementCount: disagreements.length,
    adjudicatedDisagreementCount: disagreements.filter((state) => state.adjudicated).length,
    unresolvedDisagreementCount: unresolved.length,
    invalidAdjudicationCount: invalidAdjudications.length,
    agreementRate: doubleReviewed.length === 0
      ? null
      : round((doubleReviewed.length - disagreements.length) / doubleReviewed.length),
  }
}

export function validateHumanReviewHistory(dataset) {
  for (const row of dataset.rows) {
    const reviews = Array.isArray(row.reviews) ? row.reviews : []
    const byReviewer = new Map()
    for (const review of reviews) {
      byReviewer.set(review.reviewerId, [
        ...(byReviewer.get(review.reviewerId) ?? []),
        review,
      ])
    }
    for (const reviewerReviews of byReviewer.values()) {
      reviewerReviews.sort((left, right) => left.revision - right.revision)
      for (let index = 0; index < reviewerReviews.length; index += 1) {
        const current = reviewerReviews[index]
        if (current.revision !== index + 1) {
          throw new TypeError(`non-sequential review revision for ${row.sampleId}`)
        }
        if (index > 0) {
          const previous = reviewerReviews[index - 1]
          if (!current.revisionReason) {
            throw new TypeError(`review correction requires revision reason for ${row.sampleId}`)
          }
          if (Date.parse(current.reviewedAt) < Date.parse(previous.reviewedAt)) {
            throw new TypeError(`review revision timestamp moves backwards for ${row.sampleId}`)
          }
        }
      }
    }
    const state = independentReviewState(row)
    if (state.invalidAdjudication) {
      throw new TypeError(`adjudication requires an actual independent reviewer disagreement for ${row.sampleId}`)
    }
  }
  return dataset
}

export function attachManifestContractFingerprint(dataset) {
  dataset.manifest.contractFingerprint = manifestContractFingerprint(dataset.manifest)
  return dataset
}

export function validateManifestContractFingerprint(dataset) {
  const actual = dataset?.manifest?.contractFingerprint
  if (!/^[a-f0-9]{64}$/.test(String(actual ?? ''))) {
    throw new TypeError('gold-set manifest contract fingerprint is missing')
  }
  const expected = manifestContractFingerprint(dataset.manifest)
  if (actual !== expected) {
    throw new TypeError('gold-set manifest contract fingerprint mismatch')
  }
  return dataset
}

export function manifestContractFingerprint(manifest) {
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    datasetVersion: manifest.datasetVersion,
    samplingPolicy: manifest.samplingPolicy,
    samplingSeedHash: manifest.samplingSeedHash,
    workspaceKey: manifest.workspaceKey,
    agencyProfileKey: manifest.agencyProfileKey,
    timeWindow: manifest.timeWindow,
    reviewMode: manifest.reviewMode,
    provenance: manifest.provenance,
    bucketQuotas: manifest.bucketQuotas,
    frozenFingerprint: manifest.frozenFingerprint,
  })).digest('hex')
}

function independentReviewState(row) {
  const reviews = Array.isArray(row.reviews) ? row.reviews : []
  const latestByReviewer = new Map()
  for (const review of reviews) {
    const current = latestByReviewer.get(review.reviewerId)
    if (!current || review.revision > current.revision) {
      latestByReviewer.set(review.reviewerId, review)
    }
  }
  const latest = [...latestByReviewer.values()]
  const independent = latest.filter((review) => !review.adjudication)
  const adjudications = latest.filter((review) => review.adjudication)
  if (adjudications.length > 1) {
    throw new TypeError(`multiple active adjudications for ${row.sampleId}`)
  }
  const decisions = new Set(independent.map((review) =>
    `${review.reviewLabel}:${review.actionable}`))
  const disagreement = independent.length >= 2 && decisions.size > 1
  const adjudicated = disagreement && adjudications.length === 1
  const invalidAdjudication = adjudications.length === 1 && !disagreement
  return {
    sampleId: row.sampleId,
    independentReviewCount: independent.length,
    disagreement,
    adjudicated,
    invalidAdjudication,
  }
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000
}
