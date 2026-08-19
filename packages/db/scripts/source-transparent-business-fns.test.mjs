import assert from 'node:assert/strict';
import test from 'node:test';

import { extractTransparentBusinessFnsRecords } from './source-transparent-business-fns.mjs';

test('transparent-business projection aggregates legal entities from official FNS records', () => {
  const previous = process.env.GOVERNMENT_ENRICHMENT_INNS;
  process.env.GOVERNMENT_ENRICHMENT_INNS = '7707083893';

  try {
    const records = extractTransparentBusinessFnsRecords({
      fns: [
        {
          dataset: 'headcount',
          inn: '7707083893',
          ogrn: '1027700132195',
          company_name: 'ПАО Сбербанк',
          period: '2024',
          employee_count: 293800,
          source_url: 'https://file.nalog.ru/opendata/headcount-2024.zip',
        },
        {
          dataset: 'headcount',
          inn: '7707083893',
          company_name: 'ПАО Сбербанк',
          period: '2025',
          employee_count: 300000,
          source_url: 'https://file.nalog.ru/opendata/headcount-2025.zip',
        },
        {
          dataset: 'sme-registry',
          inn: '7707083893',
          company_name: 'ПАО Сбербанк',
          period: '2025',
          sme_status: 'medium',
          source_url: 'https://file.nalog.ru/opendata/sme-2025.zip',
        },
        {
          dataset: 'tax-offence',
          inn: '7707083893',
          company_name: 'ПАО Сбербанк',
          period: '2025',
          source_url: 'https://file.nalog.ru/opendata/tax-2025.zip',
        },
        {
          dataset: 'headcount',
          inn: '123456789012',
          company_name: 'ИП Person',
          period: '2025',
          employee_count: 1,
          source_url: 'https://file.nalog.ru/opendata/headcount-ip.zip',
        },
        {
          dataset: 'headcount',
          inn: '7712345678',
          company_name: 'Untracked Co',
          period: '2025',
          employee_count: 12,
          source_url: 'https://file.nalog.ru/opendata/untracked.zip',
        },
      ],
    });

    assert.equal(records.length, 1);
    assert.equal(records[0].external_id, 'fns-open-data:7707083893');
    assert.equal(records[0].inn, '7707083893');
    assert.equal(records[0].ogrn, '1027700132195');
    assert.equal(records[0].company_name, 'ПАО Сбербанк');
    assert.equal(records[0].employee_count, 300000);
    assert.equal(records[0].msp_category, 'medium');
    assert.equal(records[0].status, 'medium');
    assert.deepEqual(records[0].risk_flags, ['tax-offence-or-penalty']);
    assert.match(records[0].source_url, /^https:\/\/file\.nalog\.ru\//);
  } finally {
    restore('GOVERNMENT_ENRICHMENT_INNS', previous);
  }
});

test('transparent-business projection preserves reviewed generic records', () => {
  const records = [{
    id: 'registry-1',
    inn: '7712345678',
    company_name: 'Reviewed Co',
  }];
  assert.equal(extractTransparentBusinessFnsRecords(records), records);
  assert.deepEqual(extractTransparentBusinessFnsRecords({ records }), records);
});

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
