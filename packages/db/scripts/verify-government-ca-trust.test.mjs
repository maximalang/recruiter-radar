import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import { verifyGovernmentCaCertificates } from './verify-government-ca-trust.mjs';

test('pins the official Russian government TLS root and current RSA intermediate', () => {
  const result = verifyGovernmentCaCertificates();
  assert.equal(result.root.fingerprint256, 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31');
  assert.equal(result.intermediate.fingerprint256, '21:55:78:50:36:C9:00:DB:B5:F1:BB:2A:15:69:C8:0C:55:59:5B:D6:BF:94:86:7A:29:BB:DD:BC:7D:88:A3:F2');
});

test('production image installs the pinned chain for Node and Chromium', () => {
  const dockerfile = readFileSync(resolve('apps/web/Dockerfile'), 'utf8');
  assert.match(dockerfile, /apk add --no-cache ca-certificates chromium nss-tools/);
  assert.match(dockerfile, /update-ca-certificates/);
  assert.match(dockerfile, /NODE_EXTRA_CA_CERTS=\/etc\/ssl\/certs\/russian-trusted-ca-bundle\.pem/);
  assert.match(dockerfile, /certutil -d "sql:\$nssdb" -A -t 'C,,' -n 'Russian Trusted Root CA'/);
  assert.match(dockerfile, /certutil -d "sql:\$nssdb" -A -t ',,' -n 'Russian Trusted Sub CA 2024'/);
  assert.doesNotMatch(dockerfile, /NODE_TLS_REJECT_UNAUTHORIZED/);
  assert.doesNotMatch(dockerfile, /ignoreHTTPSErrors/);
});
