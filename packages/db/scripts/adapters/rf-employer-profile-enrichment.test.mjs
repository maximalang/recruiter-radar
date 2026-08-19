import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractEmployerIdentityFromHtml,
  extractEmployerIdentityFromMarkdown,
  fetchRfEmployerProfile,
} from './rf-employer-profile-enrichment.mjs';

const FAMILY = { id: 'rabota-ru', platformDomains: ['rabota.ru'], transportStages: ['static-http', 'structured-data', 'rendered-dom', 'extraction'] };

const HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"Сбер","taxID":"7707083893","identifier":{"propertyID":"ОГРН","value":"1027700132195"},"url":"https://www.sberbank.ru/"}
</script></head><body>
<h1>Сбер</h1>
<div>ИНН: 7707083893</div>
<div>ОГРН: 1027700132195</div>
<a href="https://www.rabota.ru/company/42">Профиль</a>
<a href="https://vk.com/sber">Сайт компании</a>
<a href="https://www.sberbank.ru/careers?utm_source=rabota">Официальный сайт</a>
</body></html>`;

test('extracts validated INN, OGRN and official employer domain from company profile', () => {
  const profile = extractEmployerIdentityFromHtml(HTML, 'https://www.rabota.ru/company/42', FAMILY, {
    expectedEmployerName: 'Сбер',
  });
  assert.ok(profile);
  assert.equal(profile.employerName, 'Сбер');
  assert.equal(profile.employerWebsiteUrl, 'https://www.sberbank.ru/');
  assert.deepEqual(profile.strongIdentityKeys, [
    'domain:sberbank.ru',
    'inn:7707083893',
    'ogrn:1027700132195',
  ]);
});

test('social and platform links never become employer domain identity', () => {
  const profile = extractEmployerIdentityFromHtml(`
    <div>ИНН 7707083893</div>
    <a href="https://vk.com/example">Сайт компании</a>
    <a href="https://www.rabota.ru/company/42">Официальный сайт</a>
  `, 'https://www.rabota.ru/company/42', FAMILY);
  assert.ok(profile);
  assert.equal(profile.employerWebsiteUrl, null);
  assert.deepEqual(profile.strongIdentityKeys, ['inn:7707083893']);
});

test('expected employer scope rejects unrelated platform-operator INN and OGRN in footer', () => {
  const filler = 'описание вакансий и компании '.repeat(80);
  const profile = extractEmployerIdentityFromHtml(`
    <main>
      <h1>Example Employer</h1>
      <a href="https://example-employer.ru/jobs">Сайт компании</a>
      <p>${filler}</p>
    </main>
    <footer>
      <strong>ООО Оператор Площадки</strong>
      <span>ИНН: 7707083893</span>
      <span>ОГРН: 1027700132195</span>
    </footer>
  `, 'https://www.rabota.ru/company/example', FAMILY, {
    expectedEmployerName: 'Example Employer',
  });

  assert.ok(profile);
  assert.equal(profile.employerName, 'Example Employer');
  assert.equal(profile.employerWebsiteUrl, 'https://example-employer.ru/jobs');
  assert.deepEqual(profile.strongIdentityKeys, ['domain:example-employer.ru']);
});

test('unrelated Organization JSON-LD is ignored when expected employer is known', () => {
  const profile = extractEmployerIdentityFromHtml(`
    <script type="application/ld+json">
      {"@type":"Organization","name":"Job Board Operator","taxID":"7707083893","url":"https://operator.example"}
    </script>
    <h1>Target Employer</h1>
    <a href="https://target.example.ru">Официальный сайт</a>
  `, 'https://www.rabota.ru/company/target', FAMILY, {
    expectedEmployerName: 'Target Employer',
  });

  assert.ok(profile);
  assert.equal(profile.employerWebsiteUrl, 'https://target.example.ru/');
  assert.deepEqual(profile.strongIdentityKeys, ['domain:target.example.ru']);
});

test('markdown extraction accepts labelled official website and scoped legal identifiers', () => {
  const profile = extractEmployerIdentityFromMarkdown(`
Компания Example
ИНН: 7707083893
[Сайт компании](https://example.ru/?utm_source=rabota)
  `, 'https://www.rabota.ru/company/42', FAMILY, { expectedEmployerName: 'Example' });
  assert.ok(profile);
  assert.equal(profile.employerWebsiteUrl, 'https://example.ru/');
  assert.deepEqual(profile.strongIdentityKeys, ['domain:example.ru', 'inn:7707083893']);
});

test('robots denial stops before employer profile target fetch', async () => {
  const calls = [];
  const result = await fetchRfEmployerProfile(FAMILY, 'https://www.rabota.ru/company/42', {
    expectedEmployerName: 'Сбер',
    fetchTextImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('/robots.txt')) {
        return { response: { url }, body: 'User-agent: *\nDisallow: /company' };
      }
      throw new Error('profile must not be fetched');
    },
  });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'robots-disallow');
  assert.equal(calls.length, 1);
});

test('static profile proof returns strong identity without renderer fallback', async () => {
  const result = await fetchRfEmployerProfile(FAMILY, 'https://www.rabota.ru/company/42', {
    expectedEmployerName: 'Сбер',
    fetchTextImpl: async (url) => {
      if (url.endsWith('/robots.txt')) return { response: { url }, body: 'User-agent: *\nAllow: /' };
      return { response: { url }, body: HTML };
    },
  });
  assert.equal(result.blocked, false);
  assert.equal(result.selectedStage, 'structured-data');
  assert.ok(result.profile.strongIdentityKeys.includes('inn:7707083893'));
});
