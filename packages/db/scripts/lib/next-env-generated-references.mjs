const GENERATED_TYPE_FILES = Object.freeze([
  'routes.d.ts',
  'root-params.d.ts',
])

function normalizeLineEndings(value) {
  return value.replaceAll('\r\n', '\n')
}

function originalReferenceFor(original, fileName) {
  const suffix = `/types/${fileName}";`
  return original
    .split(/\r?\n/)
    .find((line) => line.startsWith('import "') && line.endsWith(suffix))
}

export function restoreGeneratedNextEnvReferences({
  current,
  original,
  generatedDistName,
}) {
  if (current === original) return original

  let sanitized = current
  for (const fileName of GENERATED_TYPE_FILES) {
    const generatedReference =
      `import "./${generatedDistName}/dev/types/${fileName}";`
    if (!sanitized.includes(generatedReference)) continue

    const originalReference = originalReferenceFor(original, fileName)
    if (!originalReference) {
      throw new Error(
        `Original next-env.d.ts ${fileName} reference was not recognized.`,
      )
    }
    sanitized = sanitized.replace(generatedReference, originalReference)
  }

  if (
    normalizeLineEndings(sanitized)
      !== normalizeLineEndings(original)
  ) {
    throw new Error(
      'next-env.d.ts changed outside the allowlisted generated type references.',
    )
  }
  return original
}
