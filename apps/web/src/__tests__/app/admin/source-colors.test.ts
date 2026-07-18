import { sourceColor } from '@/app/admin/admin-source-colors'

describe('admin source colors', () => {
  it('assigns distinct stable colors to unlisted source ids', () => {
    expect(sourceColor('hh')).toBe('#64748b')
    expect(sourceColor('transparent-business-fns')).not.toBe(sourceColor('fedresurs'))
    expect(sourceColor('transparent-business-fns')).toBe(sourceColor('transparent-business-fns'))
  })
})
