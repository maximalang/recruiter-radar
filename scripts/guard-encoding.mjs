import { readFile, readdir } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import encodingGuard from './lib/encoding-guard.cjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const scanRoots = ['apps', 'packages', 'scripts']
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.md'])
const ignoredSegments = new Set(['node_modules', '.next', 'dist', 'build', '__tests__', 'test-results'])

const { findMojibake } = encodingGuard

async function* files(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (extensions.has(extname(entry.name))) yield path
  }
}

export async function scanRepository() {
  const failures = []
  for (const scanRoot of scanRoots) {
    for await (const path of files(resolve(root, scanRoot))) {
      for (const hit of findMojibake(await readFile(path, 'utf8'))) {
        failures.push({ file: relative(root, path), ...hit })
      }
    }
  }
  return failures
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await scanRepository()
  if (failures.length > 0) {
    for (const failure of failures) console.error(`${failure.file}:${failure.line} ${failure.sample}`)
    console.error(`Encoding guard found ${failures.length} probable mojibake line(s).`)
    process.exitCode = 1
  } else {
    console.log('Encoding guard passed.')
  }
}
