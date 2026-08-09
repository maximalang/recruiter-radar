describe('encoding guard', () => {
  it('detects characteristic mojibake without rejecting normal Russian', async () => {
    const { findMojibake } = require('../../../../../scripts/lib/encoding-guard.cjs') as {
      findMojibake: (text: string) => Array<{ line: number }>
    }

    expect(findMojibake('Выберите workspace')).toEqual([])
    expect(findMojibake('\u0420\u045f\u0420\u0455\u0420\u00bb\u0421\u040a\u0420\u00b7\u0420\u0455\u0420\u0406\u0420\u00b0\u0421\u201a\u0420\u00b5\u0420\u00bb\u0421\u040a')).toHaveLength(1)
  })
})
