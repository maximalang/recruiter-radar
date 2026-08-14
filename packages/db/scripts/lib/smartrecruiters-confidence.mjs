import { countSensitiveFields } from '../adapters/source-records.mjs';
import {
  buildNormalizedInput,
  mapSmartRecruitersPostingsPayload,
} from '../source-career-pages.mjs';

export const SMARTRECRUITERS_CONFIDENCE_THRESHOLDS = Object.freeze({
  minimumCases: 32,
  minimumPositiveCases: 24,
  minimumNegativeCases: 8,
  minimumPrecision: 0.95,
  minimumRecall: 0.9,
  minimumOrganizationFidelity: 1,
  minimumOfficialEvidenceRate: 1,
  minimumDedupeRate: 0.95,
  maximumSensitiveFieldsPersisted: 0,
});

const REQUIRED_COVERAGE = Object.freeze([
  'russian',
  'multilingual',
  'missing-location',
  'missing-released-date',
  'missing-salary',
  'remote',
  'hybrid',
  'unusual-title',
]);

const TARGET = Object.freeze({
  id: 'smartrecruiters-confidence-gold',
  adapter: 'smartrecruiters-postings',
  companyName: 'Acme International',
  companyDomain: 'acme.example',
  companyWebsiteUrl: 'https://acme.example/',
  careerPageUrl: 'https://careers.smartrecruiters.com/AcmeInternational',
  sourceUrl: 'https://api.smartrecruiters.com/v1/companies/AcmeInternational/postings?limit=100&offset=0',
});

export function buildSmartRecruitersGoldSet() {
  const positives = [
    ['Senior Backend Engineer', 'London, UK', ['multilingual']],
    ['Инженер по автоматизации тестирования', 'Москва, Россия', ['russian']],
    ['Руководитель отдела подбора персонала', 'Санкт-Петербург, Россия', ['russian']],
    ['DevOps-инженер / SRE', 'Удалённо, Россия', ['russian', 'remote', 'unusual-title']],
    ['Слесарь-ремонтник 5–6 разряда', 'Екатеринбург, Россия', ['russian', 'unusual-title']],
    ['Менеджер проектов 1С:ERP', 'Гибрид, Казань', ['russian', 'hybrid', 'unusual-title']],
    ['Аналитик данных (стажёр)', null, ['russian', 'missing-location']],
    ['Inżynier Oprogramowania', 'Warszawa, Polska', ['multilingual']],
    ['Développeur·se Full Stack', 'Paris, France', ['multilingual', 'unusual-title']],
    ['Softwareentwickler:in (m/w/d)', 'Berlin, Deutschland', ['multilingual', 'unusual-title']],
    ['Ingeniero/a de Datos', 'Madrid, España', ['multilingual']],
    ['Vývojář backendu', 'Praha, Česko', ['multilingual']],
    ['ソフトウェアエンジニア', '東京, 日本', ['multilingual', 'unusual-title']],
    ['AI/ML Scientist – Trust & Safety', 'Remote', ['remote', 'unusual-title']],
    ['People Partner (m/f/d)', 'Hybrid — München', ['hybrid', 'unusual-title']],
    ['Werkstudent:in Cyber Security', 'Remote in EU', ['remote', 'multilingual', 'unusual-title']],
    ['0→1 Product Lead, Applied AI', 'New York, NY', ['unusual-title']],
    ['Cloud Platform Engineer', 'Hybrid, Dublin', ['hybrid']],
    ['Customer Success Manager', 'Remote — Americas', ['remote']],
    ['Data Protection Counsel', 'Brussels, Belgium', ['multilingual']],
    ['Manufacturing Quality Specialist', null, ['missing-location']],
    ['Graduate Rotational Programme 2027', 'Cork, Ireland', []],
    ['NOC Operator — Night Shift', 'Riga, Latvia', ['unusual-title']],
    ['Research Engineer, LLM Evaluation', 'Remote', ['remote']],
  ].map(([name, fullLocation, coverage], index) => ({
    label: `positive-${index + 1}`,
    expectedAccept: true,
    coverage: [...coverage, 'missing-salary', ...(index === 22 ? ['missing-released-date'] : [])],
    posting: {
      id: `smart-positive-${index + 1}`,
      name,
      postingUrl: `https://jobs.smartrecruiters.com/AcmeInternational/744000000000${String(index + 1).padStart(3, '0')}-${slug(name)}`,
      location: fullLocation ? { fullLocation } : undefined,
      releasedDate: index === 22 ? undefined : '2026-08-13T12:00:00.000Z',
      typeOfEmployment: { label: index % 5 === 0 ? 'Contract' : 'Full-time' },
      department: { label: index % 2 === 0 ? 'Engineering' : 'Operations' },
      creator: index === 0 ? { email: 'recruiter@example.invalid', phone: '+0-000-000-0000' } : undefined,
    },
  }));

  const negatives = [
    { label: 'negative-null', posting: null },
    { label: 'negative-string', posting: 'not-a-posting' },
    { label: 'negative-missing-title', posting: { id: 'negative-3', postingUrl: officialUrl('negative-3') } },
    { label: 'negative-blank-title', posting: { id: 'negative-4', name: '   ', postingUrl: officialUrl('negative-4') } },
    { label: 'negative-missing-id', posting: { name: 'Forged vacancy', postingUrl: officialUrl('negative-5') } },
    { label: 'negative-foreign-url', posting: { id: 'negative-6', name: 'Forged vacancy', postingUrl: 'https://attacker.example/jobs/6' } },
    { label: 'negative-script-url', posting: { id: 'negative-7', name: 'Forged vacancy', postingUrl: 'javascript:alert(1)' } },
    { label: 'negative-invalid-date', posting: { id: 'negative-8', name: 'Malformed dated vacancy', postingUrl: officialUrl('negative-8'), releasedDate: 'not-a-date' } },
  ].map((entry) => ({ ...entry, expectedAccept: false, coverage: [] }));

  return [...positives, ...negatives];
}

export function evaluateSmartRecruitersGoldSet(goldSet) {
  const outcomes = goldSet.map((entry) => evaluateCase(entry));
  const truePositives = outcomes.filter((entry) => entry.expectedAccept && entry.predictedAccept).length;
  const falsePositives = outcomes.filter((entry) => !entry.expectedAccept && entry.predictedAccept).length;
  const falseNegatives = outcomes.filter((entry) => entry.expectedAccept && !entry.predictedAccept).length;
  const positiveCases = outcomes.filter((entry) => entry.expectedAccept).length;
  const negativeCases = outcomes.length - positiveCases;
  const precision = divide(truePositives, truePositives + falsePositives);
  const recall = divide(truePositives, truePositives + falseNegatives);
  const acceptedPositives = outcomes.filter((entry) => entry.expectedAccept && entry.predictedAccept);
  const organizationFidelity = divide(
    acceptedPositives.filter((entry) => entry.organizationFidelity).length,
    acceptedPositives.length,
  );
  const officialEvidenceRate = divide(
    acceptedPositives.filter((entry) => entry.officialEvidence).length,
    acceptedPositives.length,
  );
  const sensitiveFieldsPersisted = acceptedPositives.reduce(
    (total, entry) => total + entry.sensitiveFieldsPersisted,
    0,
  );
  const covered = new Set(
    goldSet.filter((entry) => entry.expectedAccept).flatMap((entry) => entry.coverage),
  );
  const missingCoverage = REQUIRED_COVERAGE.filter((name) => !covered.has(name));
  const dedupeRate = evaluateDedupe(goldSet);
  const thresholds = SMARTRECRUITERS_CONFIDENCE_THRESHOLDS;
  const passed = outcomes.length >= thresholds.minimumCases
    && positiveCases >= thresholds.minimumPositiveCases
    && negativeCases >= thresholds.minimumNegativeCases
    && precision >= thresholds.minimumPrecision
    && recall >= thresholds.minimumRecall
    && organizationFidelity >= thresholds.minimumOrganizationFidelity
    && officialEvidenceRate >= thresholds.minimumOfficialEvidenceRate
    && dedupeRate >= thresholds.minimumDedupeRate
    && sensitiveFieldsPersisted <= thresholds.maximumSensitiveFieldsPersisted
    && missingCoverage.length === 0;

  return {
    cases: outcomes.length,
    positiveCases,
    negativeCases,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    organizationFidelity,
    officialEvidenceRate,
    sensitiveFieldsPersisted,
    dedupeRate,
    missingCoverage,
    failedCases: outcomes.filter((entry) => entry.expectedAccept !== entry.predictedAccept).map((entry) => entry.label),
    passed,
  };
}

function evaluateCase(entry) {
  const mapped = mapSmartRecruitersPostingsPayload({ content: [entry.posting] }, TARGET);
  const input = normalize(mapped);
  const record = input.normalizedRecords[0] ?? null;
  return {
    label: entry.label,
    expectedAccept: entry.expectedAccept,
    predictedAccept: input.normalizedRecords.length === 1,
    organizationFidelity: record
      ? record.sourceId === 'smartrecruiters'
        && record.companyName === TARGET.companyName
        && record.companyDomain === TARGET.companyDomain
      : false,
    officialEvidence: record ? isOfficialEvidenceUrl(record.jobPostingUrl) : false,
    sensitiveFieldsPersisted: record ? countSensitiveFields(record.rawRecord) : 0,
  };
}

function evaluateDedupe(goldSet) {
  const positive = goldSet.find((entry) => entry.expectedAccept);
  if (!positive) return 0;
  const mapped = mapSmartRecruitersPostingsPayload({ content: [positive.posting, positive.posting] }, TARGET);
  const input = normalize(mapped);
  return input.normalizedRecords.length === 1 && input.duplicateRecords === 1 ? 1 : 0;
}

function normalize(records) {
  return buildNormalizedInput({
    records,
    inputMode: 'confidence-gold-set',
    inputFilePath: null,
    targetsFilePath: null,
    fetchOutputPath: null,
    targetResults: [],
    discoverySummary: null,
  });
}

function isOfficialEvidenceUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'jobs.smartrecruiters.com' || host === 'api.smartrecruiters.com';
  } catch {
    return false;
  }
}

function officialUrl(id) {
  return `https://jobs.smartrecruiters.com/AcmeInternational/${id}`;
}

function slug(value) {
  return String(value).normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vacancy';
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}
