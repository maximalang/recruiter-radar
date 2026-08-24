import fs from 'node:fs'
import path from 'node:path'

describe('Situation terminology contract', () => {
  it('uses the final V1-V6 review label in the primary situation scan surface', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'app/opportunities/situation-row.tsx'),
      'utf8',
    )

    expect(source).toContain("review: 'На проверке'")
    expect(source).not.toContain("review: 'Нужна проверка'")
  })
})
