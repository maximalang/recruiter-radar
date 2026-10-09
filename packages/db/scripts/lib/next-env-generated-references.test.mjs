import assert from 'node:assert/strict'
import test from 'node:test'

import { restoreGeneratedNextEnvReferences } from './next-env-generated-references.mjs'

const original = [
  '/// <reference types="next" />',
  '/// <reference types="next/image-types/global" />',
  'import "./.next/types/routes.d.ts";',
  'import "./.next/types/root-params.d.ts";',
  '',
  '// NOTE: This file should not be edited',
  '',
].join('\n')

const generatedDistName = '.next-auth-v2-e2e-1234'

function generatedContent() {
  return original
    .replace(
      'import "./.next/types/routes.d.ts";',
      `import "./${generatedDistName}/dev/types/routes.d.ts";`,
    )
    .replace(
      'import "./.next/types/root-params.d.ts";',
      `import "./${generatedDistName}/dev/types/root-params.d.ts";`,
    )
}

test('restores the allowlisted Next 16 generated type references', () => {
  assert.equal(
    restoreGeneratedNextEnvReferences({
      current: generatedContent(),
      original,
      generatedDistName,
    }),
    original,
  )
})

test('accepts the older routes-only generated reference', () => {
  const olderOriginal = original.replace(
    'import "./.next/types/root-params.d.ts";\n',
    '',
  )
  const current = olderOriginal.replace(
    'import "./.next/types/routes.d.ts";',
    `import "./${generatedDistName}/dev/types/routes.d.ts";`,
  )
  assert.equal(
    restoreGeneratedNextEnvReferences({
      current,
      original: olderOriginal,
      generatedDistName,
    }),
    olderOriginal,
  )
})

test('fails closed on any unrelated next-env change', () => {
  assert.throws(
    () => restoreGeneratedNextEnvReferences({
      current: `${generatedContent()}// unexpected\n`,
      original,
      generatedDistName,
    }),
    /outside the allowlisted generated type references/,
  )
})

test('fails closed when a generated reference has no original counterpart', () => {
  const withoutRootParams = original.replace(
    'import "./.next/types/root-params.d.ts";\n',
    '',
  )
  assert.throws(
    () => restoreGeneratedNextEnvReferences({
      current: generatedContent(),
      original: withoutRootParams,
      generatedDistName,
    }),
    /root-params\.d\.ts.*not recognized/,
  )
})
