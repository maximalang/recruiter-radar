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
 *
 * `maxPages` bounds one frequent discovery cycle. It is a recall/freshness budget,
 * not permission to enumerate a site without limit. Pagination is followed only
 * when the current public page exposes a same-platform pagination link.
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
      Object.freeze({
        kind: 'public-vacancy-search',
        baseUrl: 'https://www.avito.ru/rossiya/vakansii',
        market: 'russia',
        maxPages: 4,
      }),
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
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://www.rabota.ru/vacancy', market: 'moscow', maxPages: 2 }),
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://spb.rabota.ru/vacancy', market: 'saint-petersburg', maxPages: 2 }),
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://eburg.rabota.ru/vacancy', market: 'ekaterinburg', maxPages: 2 }),
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://nsk.rabota.ru/vacancy', market: 'novosibirsk', maxPages: 2 }),
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://kazan.rabota.ru/vacancy', market: 'kazan', maxPages: 2 }),
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://nn.rabota.ru/vacancy', market: 'nizhny-novgorod', maxPages: 2 }),
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://samara.rabota.ru/vacancy', market: 'samara', maxPages: 2 }),
      Object.freeze({ kind: 'company-catalog', baseUrl: 'https://www.rabota.ru/company/', market: 'moscow' }),
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
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://getmatch.ru/vacancies', market: 'rf-it', maxPages: 4 }),
      Object.freeze({ kind: 'company-catalog', baseUrl: 'https://getmatch.ru/companies', market: 'rf-it' }),
      Object.freeze({ kind: 'specialty-catalog', baseUrl: 'https://getmatch.ru/catalog', market: 'rf-it' }),
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
      Object.freeze({ kind: 'vacancy-catalog', baseUrl: 'https://geekjob.ru/vacancies/', market: 'rf-it', maxPages: 8 }),
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
      Object.freeze({ kind: 'public-vacancy-search', baseUrl: 'https://zarplata.ru/search/vacancy', market: 'russia', maxPages: 5 }),
      Object.freeze({ kind: 'company-catalog', baseUrl: 'https://zarplata.ru/employers_list', market: 'russia' }),
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
    for (const surface of family.discoverySurfaces) {
      if (!surface?.kind || !surface?.baseUrl) {
        throw new TypeError(`${id}.discoverySurfaces entries require kind and baseUrl`);
      }
      if (surface.maxPages !== undefined && (!Number.isInteger(surface.maxPages) || surface.maxPages < 1 || surface.maxPages > 20)) {
        throw new TypeError(`${id}.${surface.kind}.maxPages must be an integer from 1 to 20`);
      }
    }
    if (family.productionState !== 'candidate') {
      throw new TypeError(`${id}.productionState must stay candidate until production lineage proof exists`);
    }
  }
  return true;
}
