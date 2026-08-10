import fs from 'node:fs/promises'
import {
  buildTemporalEvaluationSplits,
  evaluateCommercialSignalV2,
} from './lib/commercial-signal-evaluation-v2.mjs'
import {
  GOLD_REQUIREMENTS,
  REPORT_SCHEMA,
  buildSegments,
  parseDatasetJsonl,
  resolveGoldReviewState,
  summarizeReviews,
  toEvaluationV2Rows,
} from './lib/commercial-signal-gold-set-v1.mjs'

const args = process.argv.slice(2)
const datasetPaths = multi('--dataset')
if (!datasetPaths.length) throw new TypeError('At least one --dataset is required.')
const evaluationAt = timestamp(required('--evaluation-at'))
const datasets = await Promise.all(datasetPaths.map(async (file) =>
  parseDatasetJsonl(await fs.readFile(file, 'utf8'))))
const rows = datasets.flatMap(toEvaluationV2Rows)
const sampleIds = rows.map((row) => row.sampleKey)
if (new Set(sampleIds).size !== sampleIds.length) {
  throw new Error('The same frozen sample cannot appear in more than one evaluated dataset revision.')
}
const review = summarizeReviews(datasets)
const evaluator = evaluateCommercialSignalV2(rows, {
  provenance: 'anonymized_real',
  evaluationAt,
  minimumSample: GOLD_REQUIREMENTS.minimumReviewedSamples,
  minimumLabeled: GOLD_REQUIREMENTS.minimumReviewedSamples,
})
const temporal = temporalReport(rows, evaluationAt)
const qualityP10 = evaluator.models.quality_engine_v2.precisionAt10.value
const baselineP10 = evaluator.models.opportunity_v3.precisionAt10.value
const finals = datasets.flatMap((dataset) => dataset.rows
  .map(resolveGoldReviewState)
  .map((state) => state.finalReview)
  .filter(Boolean))
const report = {
  schemaVersion: REPORT_SCHEMA,
  generatedAt: evaluationAt,
  status: review.operationalStatus,
  evidenceStatus: {
    CONTRACT_TESTED: true,
    READY_FOR_HUMAN_LABELING: true,
    HUMAN_REVIEWED: review.reviewedCount > 0,
    QUALITY_VALIDATED: false,
  },
  datasets: datasets.map((dataset) => ({
    datasetVersion:dataset.manifest.datasetVersion,
    datasetRevision:dataset.manifest.datasetRevision,
    labelRevision:dataset.manifest.labelRevision,
    frozenFingerprint:dataset.manifest.frozenFingerprint,
    sampleCount:dataset.manifest.sampleCount,
    agencyProfileKey:dataset.manifest.agencyProfileKey,
  })),
  review,
  rankingQuality: {
    opportunityV3: evaluator.models.opportunity_v3,
    qualityEngineV2: evaluator.models.quality_engine_v2,
    comparison: evaluator.comparison,
    actionableOpportunityRate: review.actionableRate,
  },
  errors: {
    opportunityV3FalsePositiveRateAt10: baselineP10 == null ? null : round(1-baselineP10),
    qualityV2FalsePositiveRateAt10: qualityP10 == null ? null : round(1-qualityP10),
    falsePositiveTaxonomy: evaluator.falsePositiveTaxonomy,
    falseNegativeTaxonomy: evaluator.falseNegativeTaxonomy,
    missedOpportunityReviewedCount: datasets.flatMap((dataset)=>dataset.rows)
      .filter((row)=>row.samplingBuckets.includes('missed_opportunity') &&
        resolveGoldReviewState(row).finalReview).length,
  },
  evidence: {
    human: {
      completenessRate:review.evidenceCompleteRate,
      corroboratedRate:review.corroboratedRate,
      directHiringProofRate:review.directHiringProofRate,
    },
    qualityCoverage:evaluator.qualityCoverage,
    qualityConfidence:evaluator.qualityConfidence,
    qualityUnknownFeatureCount:datasets.flatMap((dataset)=>dataset.rows)
      .reduce((count,row)=>count+row.model.quality.unknownFeatureCount,0),
    notSupportedCount: finals.filter((item)=>item.observationSupport === 'not_supported').length,
    unknownObservationCount: finals.filter((item)=>item.observationSupport === 'unknown').length,
    featureCoverageComparison:{
      status:'not_comparable',
      reason:'Opportunity v3 Agency DNA coverage and Quality v2 feature coverage are different measures; Stage 2 does not invent a before/after percentage.',
    },
  },
  rankingChanges:evaluator.rankingChanges,
  segments:buildSegments(datasets),
  temporalSplits:temporal,
  safeguards:{
    automaticWeightTuning:false,
    thresholdChanges:false,
    featureFlagEnablement:false,
    readerSwitch:false,
    productionWrites:false,
    canary:false,
  },
  decision:{
    qualityValidated:false,
    reason:'This tooling deliberately never auto-promotes an evaluation to QUALITY_VALIDATED. A sufficient frozen human-reviewed validation/temporal holdout and explicit human decision are required before any canary plan.',
  },
}
process.stdout.write(`${JSON.stringify(report,null,2)}\n`)

function temporalReport(rows,evaluationAt){
  const train=option('--train-before')
  const validation=option('--validation-before')
  const holdout=option('--holdout-before')
  if (![train,validation,holdout].some(Boolean)) return { status:'not_requested' }
  if (![train,validation,holdout].every(Boolean)) {
    throw new TypeError('Temporal evaluation requires --train-before, --validation-before and --holdout-before together.')
  }
  const splits=buildTemporalEvaluationSplits(rows,{
    trainBefore:train,
    validationBefore:validation,
    holdoutBefore:holdout,
  })
  return Object.fromEntries(Object.entries(splits).map(([name,splitRows])=>[
    name,
    evaluateCommercialSignalV2(splitRows,{
      provenance:'anonymized_real',
      evaluationAt,
      minimumSample:GOLD_REQUIREMENTS.minimumReviewedSamples,
      minimumLabeled:GOLD_REQUIREMENTS.minimumReviewedSamples,
    }),
  ]))
}
function multi(name){
  const output=[]
  for(let index=0;index<args.length;index++) {
    if(args[index]===name&&args[index+1]) output.push(args[index+1])
  }
  return output
}
function required(name){
  const value=option(name)
  if(!value) throw new TypeError(`${name} is required.`)
  return value
}
function option(name){
  const index=args.indexOf(name)
  return index>=0?args[index+1]:null
}
function timestamp(value){
  const parsed=Date.parse(String(value))
  if(!Number.isFinite(parsed)) throw new TypeError('--evaluation-at is invalid.')
  return new Date(parsed).toISOString()
}
function round(value){ return Math.round(value*1e6)/1e6 }
