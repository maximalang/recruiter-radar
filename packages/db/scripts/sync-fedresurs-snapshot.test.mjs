import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  assertOfficialFedresursArchiveUrl,
  parseFedresursExportIndex,
  parseFedresursXmlStream,
} from './sync-fedresurs-snapshot.mjs';

test('Fedresurs index parser discovers bounded monthly public exports', () => {
  const html = `
    <a href="../">../</a>
    <a href="04-2026.7z">04-2026.7z</a> 17-May-2026 01:11 3G
    <a href="05-2026.7z">05-2026.7z</a> 17-Jun-2026 00:44 205M
    <a href="06-2026.7z">06-2026.7z</a> 17-Jul-2026 00:54 227M
  `;
  const entries = parseFedresursExportIndex(html, 2026);
  assert.equal(entries.length, 3);
  assert.equal(entries[2].month, 6);
  assert.equal(entries[2].bytes, 227 * 1024 * 1024);
  assert.equal(
    entries[2].url,
    'https://download.fedresurs.ru/export_messages/2026/06-2026.7z',
  );
});

test('Fedresurs archive URL is locked to the official export path', () => {
  assert.equal(
    assertOfficialFedresursArchiveUrl('https://download.fedresurs.ru/export_messages/2026/06-2026.7z'),
    'https://download.fedresurs.ru/export_messages/2026/06-2026.7z',
  );
  assert.throws(
    () => assertOfficialFedresursArchiveUrl('https://example.com/export_messages/2026/06-2026.7z'),
    /approved public export path/,
  );
  assert.throws(
    () => assertOfficialFedresursArchiveUrl('https://download.fedresurs.ru/files/06-2026.7z'),
    /approved public export path/,
  );
});

test('Fedresurs XML stream keeps only unambiguous tracked legal entities', async () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <Message Guid="11111111-1111-4111-8111-111111111111">
      <Company>
        <INN>7707083893</INN>
        <CompanyName>ПАО Сбербанк</CompanyName>
      </Company>
      <MessageTypeName>Сведения о реорганизации юридического лица</MessageTypeName>
      <PublishDate>2026-07-15T10:30:00+03:00</PublishDate>
    </Message>
    <?xml version="1.0" encoding="utf-8"?>
    <Message Guid="22222222-2222-4222-8222-222222222222">
      <Company><INN>7712345678</INN><CompanyName>Untracked Co</CompanyName></Company>
      <MessageTypeName>Сведения о ликвидации</MessageTypeName>
      <PublishDate>2026-07-15T11:00:00+03:00</PublishDate>
    </Message>
    <?xml version="1.0" encoding="utf-8"?>
    <Message Guid="33333333-3333-4333-8333-333333333333">
      <Company><INN>7707083893</INN><CompanyName>ПАО Сбербанк</CompanyName></Company>
      <Counterparty><INN>7712345678</INN><Name>Other Co</Name></Counterparty>
      <MessageTypeName>Сведения о залоге</MessageTypeName>
    </Message>`;

  const records = await parseFedresursXmlStream(Readable.from([Buffer.from(xml)]), {
    sourceUrl: 'https://download.fedresurs.ru/export_messages/2026/06-2026.7z',
    trackedInns: ['7707083893'],
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].inn, '7707083893');
  assert.equal(records[0].company_name, 'ПАО Сбербанк');
  assert.equal(records[0].event_type, 'reorganization');
  assert.equal(records[0].external_id, 'fedresurs:11111111-1111-4111-8111-111111111111');
  assert.equal(records[0].published_at, '2026-07-15T07:30:00.000Z');
  assert.equal(records.diagnostics.documents, 3);
  assert.equal(records.diagnostics.trackedDocuments, 1);
  assert.equal(records.diagnostics.ambiguousDocuments, 1);
});
