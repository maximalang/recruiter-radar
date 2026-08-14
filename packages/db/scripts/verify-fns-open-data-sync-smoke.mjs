import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  assertOfficialFnsArchiveUrl,
  buildFnsSnapshot,
  parseFnsXmlStream,
} from './sync-fns-open-data-snapshot.mjs';

const trackedInns = new Set(['7707083893']);
const headcountXml = `<?xml version="1.0" encoding="windows-1251"?>
<Файл>
  <Документ ДатаДок="25.06.2026" ДатаСост="31.12.2025">
    <СведНП НаимОрг="ПАО СБЕРБАНК" ИННЮЛ="7707083893" />
    <СведССЧР КолРаб="310000" />
  </Документ>
  <Документ ДатаДок="25.06.2026" ДатаСост="31.12.2025">
    <СведНП НаимОрг="ИП" ИННФЛ="770100000001" />
    <СведССЧР КолРаб="1" />
  </Документ>
</Файл><?xml version="1.0" encoding="windows-1251"?><Файл><Документ ДатаДок="25.06.2026" ДатаСост="31.12.2025"><СведНП НаимОрг="НЕ В ПУЛЕ" ИННЮЛ="7701000000"/><СведССЧР КолРаб="2"/></Документ></Файл>`;
const revenueXml = `<?xml version="1.0" encoding="windows-1251"?>
<Файл><Документ ДатаДок="01.05.2026" ДатаСост="31.12.2025"><СведНП НаимОрг="ПАО СБЕРБАНК" ИННЮЛ="7707083893"/><СведДоходРасх СумДоход="4200000000000" СумРасход="3900000000000"/></Документ></Файл>`;
const taxRegimeXml = `<?xml version="1.0" encoding="windows-1251"?>
<Файл><Документ ДатаДок="25.05.2026" ДатаСост="31.12.2025"><СведНП НаимОрг="ПАО СБЕРБАНК" ИННЮЛ="7707083893"/><СведСНР ПризнЕСХН="0" ПризнУСН="1" ПризнАУСН="0" ПризнСРП="0"/></Документ></Файл>`;

const declarationBoundary = headcountXml.indexOf('<?xml', 10) + 3;
const headcount = await parseFnsXmlStream(Readable.from([
  headcountXml.slice(0, declarationBoundary),
  headcountXml.slice(declarationBoundary),
]), {
  dataset: 'headcount',
  sourceUrl: 'https://file.nalog.ru/opendata/7707329152-sshr2019/data-20260625-structure-20200408.zip',
  trackedInns,
});
assert.deepEqual(headcount, [{
  dataset: 'headcount',
  period: '2025-12-31',
  inn: '7707083893',
  company_name: 'ПАО СБЕРБАНК',
  employee_count: 310000,
  source_url: 'https://file.nalog.ru/opendata/7707329152-sshr2019/data-20260625-structure-20200408.zip',
}]);

const revenue = await parseFnsXmlStream(Readable.from([revenueXml]), {
  dataset: 'revenue-expenses',
  sourceUrl: 'https://file.nalog.ru/opendata/7707329152-revexp/data-20260501-structure-20180110.zip',
  trackedInns,
});
assert.equal(revenue[0].revenue, 4_200_000_000_000);
assert.equal(revenue[0].expenses, 3_900_000_000_000);

const taxRegime = await parseFnsXmlStream(Readable.from([taxRegimeXml]), {
  dataset: 'tax-regime',
  sourceUrl: 'https://file.nalog.ru/opendata/7707329152-snr/data-20260525-structure-20230425.zip',
  trackedInns,
});
assert.equal(taxRegime[0].tax_regime, 'simplified-tax-system');

const snapshot = buildFnsSnapshot({
  records: [
    { ...headcount[0], period: '2025-06-25', employee_count: 290000 },
    ...taxRegime,
    ...headcount,
    { ...headcount[0], employee_count: 1 },
    ...revenue,
  ],
  trackedInns,
  datasets: [
    { dataset: 'headcount', sha256: 'a'.repeat(64), bytes: 123 },
    { dataset: 'revenue-expenses', sha256: 'b'.repeat(64), bytes: 456 },
  ],
  generatedAt: '2026-08-12T21:00:00.000Z',
});
assert.equal(snapshot.schema_version, 1);
assert.deepEqual(snapshot.tracked_inns, ['7707083893']);
assert.deepEqual(snapshot.fns.map((record) => record.dataset), ['headcount', 'headcount', 'revenue-expenses', 'tax-regime']);
assert.equal(snapshot.fns.find((record) => record.period === '2025-12-31').employee_count, 1);
assert.equal(JSON.stringify(snapshot).match(/phone|email|ИННФЛ/gi), null);

assert.equal(
  assertOfficialFnsArchiveUrl('headcount', 'https://file.nalog.ru/opendata/7707329152-sshr2019/data-20260625-structure-20200408.zip'),
  'https://file.nalog.ru/opendata/7707329152-sshr2019/data-20260625-structure-20200408.zip',
);
assert.throws(
  () => assertOfficialFnsArchiveUrl('headcount', 'https://example.com/fake.zip'),
  /official FNS archive/i,
);

console.log(JSON.stringify({
  ok: true,
  smoke: 'fns-open-data-sync',
  records: snapshot.fns.length,
  datasets: snapshot.fns.map((record) => record.dataset),
  trackedLegalEntities: snapshot.tracked_inns.length,
}, null, 2));
