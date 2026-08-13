import assert from 'node:assert/strict';

import { SOURCE_ESCALATION_STAGES, runSourceEscalation } from './source-escalation.mjs';

const validVacancy = {
  company_name: 'Example',
  job_title: 'Engineer',
  job_posting_url: 'https://example.test/jobs/engineer',
};

const validateVacancy = (record) => Boolean(
  record?.company_name
  && record?.job_title
  && new URL(record?.job_posting_url).protocol === 'https:',
);

assert.deepEqual(SOURCE_ESCALATION_STAGES, [
  'official-feed',
  'static-http',
  'structured-data',
  'rendered-dom',
  'extraction',
]);

{
  const called = [];
  const result = await runSourceEscalation({
    validateRecord: validateVacancy,
    stages: {
      'official-feed': async () => {
        called.push('official-feed');
        return { records: [validVacancy], artifact: '<rss />' };
      },
      'static-http': async () => { called.push('static-http'); return {}; },
    },
  });
  assert.equal(result.selectedStage, 'official-feed');
  assert.deepEqual(result.records, [validVacancy]);
  assert.deepEqual(called, ['official-feed']);
}

{
  const called = [];
  const result = await runSourceEscalation({
    validateRecord: validateVacancy,
    stages: {
      'static-http': async () => {
        called.push('static-http');
        return { artifact: '<html><script type="application/ld+json">{}</script></html>' };
      },
      'structured-data': async ({ artifact }) => {
        called.push('structured-data');
        assert.match(artifact, /ld\+json/);
        return { records: [validVacancy] };
      },
      'rendered-dom': async () => { called.push('rendered-dom'); return {}; },
    },
  });
  assert.equal(result.selectedStage, 'structured-data');
  assert.deepEqual(called, ['static-http', 'structured-data']);
}

{
  const called = [];
  const result = await runSourceEscalation({
    validateRecord: validateVacancy,
    stages: {
      'static-http': async () => {
        called.push('static-http');
        return { status: 'blocked', httpStatus: 403, reason: 'access-denied' };
      },
      'rendered-dom': async () => { called.push('rendered-dom'); return {}; },
      extraction: async () => { called.push('extraction'); return {}; },
    },
  });
  assert.equal(result.selectedStage, null);
  assert.equal(result.stoppedByPolicy, true);
  assert.deepEqual(called, ['static-http']);
  assert.equal(result.attempts[0].outcome, 'blocked');
}

{
  const result = await runSourceEscalation({
    validateRecord: validateVacancy,
    stages: {
      'static-http': async () => ({ artifact: '<html><div id="root"></div></html>' }),
      'structured-data': async () => ({ records: [] }),
      'rendered-dom': async () => ({ artifact: '<html><a href="/jobs/engineer">Engineer</a></html>' }),
      extraction: async ({ artifact }) => {
        assert.match(artifact, /Engineer/);
        return {
          records: [
            { company_name: 'Example', job_title: '', job_posting_url: 'https://example.test/jobs/missing' },
            validVacancy,
          ],
        };
      },
    },
  });
  assert.equal(result.selectedStage, 'extraction');
  assert.deepEqual(result.records, [validVacancy]);
  assert.equal(result.attempts.at(-1).rejectedRecords, 1);
}

{
  const result = await runSourceEscalation({
    validateRecord: validateVacancy,
    stages: {
      'official-feed': async () => ({ status: 'deferred', httpStatus: 429, reason: 'rate-limited' }),
      'static-http': async () => ({ records: [validVacancy] }),
    },
  });
  assert.equal(result.selectedStage, null);
  assert.equal(result.stoppedByPolicy, true);
  assert.equal(result.attempts[0].outcome, 'deferred');
}

for (const [status, outcome] of [[403, 'blocked'], [407, 'blocked'], [429, 'deferred']]) {
  let staticCalled = false;
  const result = await runSourceEscalation({
    validateRecord: validateVacancy,
    stages: {
      'official-feed': async () => {
        const error = new Error(`HTTP ${status}`);
        error.status = status;
        throw error;
      },
      'static-http': async () => {
        staticCalled = true;
        return { records: [validVacancy] };
      },
    },
  });
  assert.equal(result.stoppedByPolicy, true);
  assert.equal(result.attempts[0].outcome, outcome);
  assert.equal(staticCalled, false);
}

{
  let renderedCalled = false;
  const result = await runSourceEscalation({
    validateRecord: validateVacancy,
    stages: {
      'static-http': async () => ({ status: 'not-modified', terminal: true }),
      'rendered-dom': async () => { renderedCalled = true; return {}; },
    },
  });
  assert.equal(result.stoppedByPolicy, false);
  assert.equal(result.attempts[0].outcome, 'not-modified');
  assert.equal(renderedCalled, false);
}

console.log(JSON.stringify({
  ok: true,
  smoke: 'source-escalation',
  stages: SOURCE_ESCALATION_STAGES,
}, null, 2));
