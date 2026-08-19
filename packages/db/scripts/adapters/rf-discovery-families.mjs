import { SOURCE_ESCALATION_STAGES } from './source-escalation.mjs';

/**
 * RF Source Intelligence V2 discovery-family contract.
 *
 * A discovery family is intentionally NOT equivalent to a live source id.
 * Families describe public acquisition surfaces and their evidence role. A family
 * becomes production-live only after a fresh evidence -> signal -> lineage proof.
 *
 * Transport policy is conservative by design: the canonical escalation layer
 * stops on robots denial, access controls, captcha/WAF and 429 responses. These
 * fallbacks improve resilience; they are never an anti-bot bypass mechanism.
 */

export const RF_DISCOVERY_FAMILY_IDS = Object.freeze([
  'avito-rabota',
  'rabota-ru',
  'getmatch',
  'geekjob',
  'zarplata-ru',
]);

export const RF_DISCOVERY_FAMILIES = Object.freeze({
  'avito-rabota': Object.freeze({
    id: 'avito-rabota',
    label: 'Авито Работа',
    evidenceFamily: 'job-board',
    scope: 'rf-broad-market',
    platformDomains: Object.freeze(['avito.ru']),
    discoverySurfaces: Object.freeze([
      Object.freeze({ kind: 'public-vacancy-search', baseUrl: 'https://www.avito.ru/rossiya/vakansii' }),
    ]),
    transportStages: Object.freeze(['static-http', 'structured-data', 'rendered-dom', 'extraction']),
    directEmployerCorroborationRequired: true,
    productionState: 'candidate',
  }),
  'rabota-ru': Object.freeze({
    id: 'rabota-ru',
    label: 'Работа.ру',
    evidenceFamily: 'job-board',
    scope: 'rf-broad-market',
    platformDomains: Object.freeze(['rabota.ru']),
    discoverySurfaces: Object.freeze([
      Object.freeze({ kind: 'company-catalog', baseUrl: 'https://www.rabota.ru/company/' }),
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://www.rabota.ru/vacancy/' }),
    ]),
    transportStages: Object.freeze(['static-http', 'structured-data', 'rendered-dom', 'extraction']),
    directEmployerCorroborationRequired: true,
    productionState: 'candidate',
  }),
  getmatch: Object.freeze({
    id: 'getmatch',
    label: 'getmatch',
    evidenceFamily: 'job-board-it',
    scope: 'rf-it-digital',
    platformDomains: Object.freeze(['getmatch.ru']),
    discoverySurfaces: Object.freeze([
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://getmatch.ru/vacancies' }),
      Object.freeze({ kind: 'company-catalog', baseUrl: 'https://getmatch.ru/companies' }),
      Object.freeze({ kind: 'specialty-catalog', baseUrl: 'https://getmatch.ru/catalog' }),
    ]),
    transportStages: Object.freeze(['static-http', 'structured-data', 'rendered-dom', 'extraction']),
    directEmployerCorroborationRequired: true,
    productionState: 'candidate',
  }),
  geekjob: Object.freeze({
    id: 'geekjob',
    label: 'GeekJob',
    evidenceFamily: 'job-board-it',
    scope: 'rf-it-digital',
    platformDomains: Object.freeze(['geekjob.ru']),
    discoverySurfaces: Object.freeze([
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://geekjob.ru/vacancies/' }),
    ]),
    transportStages: Object.freeze(['static-http', 'structured-data', 'rendered-dom', 'extraction']),
    directEmployerCorroborationRequired: true,
    productionState: 'candidate',
  }),
  'zarplata-ru': Object.freeze({
    id: 'zarplata-ru',
    label: 'Зарплата.ру',
    evidenceFamily: 'job-board',
    scope: 'rf-broad-market',
    platformDomains: Object.freeze(['zarplata.ru']),
    discoverySurfaces: Object.freeze([
      Object.freeze({ kind: 'public-vacancy-search', baseUrl: 'https://zarplata.ru/vacancies' }),
      Object.freeze({ kind: 'company-catalog', baseUrl: 'https://zarplata.ru/employers' }),
    ]),
    transportStages: Object.freeze(['static-http', 'structured-data', 'rendered-dom', 'extraction']),
    directEmployerCorroborationRequired: true,
    productionState: 'candidate',
  }),
});

export function getRfDiscoveryFamily(id) {
  const family = RF_DISCOVERY_FAMILIES[id];
  if (!family) throw new Error(`Unknown RF discovery family: ${id}`);
  return family;
}

export function listRfDiscoveryFamilies() {
  return RF_DISCOVERY_FAMILY_IDS.map((id) => RF_DISCOVERY_FAMILIES[id]);
}

export function validateRfDiscoveryFamilies(families = RF_DISCOVERY_FAMILIES) {
  for (const id of RF_DISCOVERY_FAMILY_IDS) {
    const family = families[id];
    if (!family || family.id !== id) throw new TypeError(`Missing RF discovery family: ${id}`);
    if (!Array.isArray(family.platformDomains) || family.platformDomains.length === 0) {
      throw new TypeError(`${id}.platformDomains must be non-empty`);
    }
    if (!Array.isArray(family.discoverySurfaces) || family.discoverySurfaces.length === 0) {
      throw new TypeError(`${id}.discoverySurfaces must be non-empty`);
    }
    if (!Array.isArray(family.transportStages) || family.transportStages.length === 0) {
      throw new TypeError(`${id}.transportStages must be non-empty`);
    }
    for (const stage of family.transportStages) {
      if (!SOURCE_ESCALATION_STAGES.includes(stage)) {
        throw new TypeError(`${id}.transportStages contains unsupported stage: ${stage}`);
      }
    }
    if (family.productionState !== 'candidate') {
      throw new TypeError(`${id}.productionState must stay candidate until production lineage proof exists`);
    }
  }
  return true;
}
