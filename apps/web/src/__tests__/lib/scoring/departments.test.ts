import { extractDepartments } from '@/lib/scoring/departments'
import type { Department } from '@/lib/scoring/departments'

const findByName = (deps: Department[], name: string) =>
  deps.find((d) => d.name.toLowerCase() === name.toLowerCase())

describe('extractDepartments', () => {
  describe('contract', () => {
    it('returns an empty array on empty input', () => {
      expect(extractDepartments('')).toEqual([])
    })

    it('returns an empty array when no department signals are present', () => {
      expect(extractDepartments('<p>Welcome to Acme</p>')).toEqual([])
    })
  })

  describe('headings', () => {
    it('extracts known english department names from h2/h3/h4 headings', () => {
      const html = `
        <h2>Engineering</h2>
        <h3>Sales</h3>
        <h4>Marketing</h4>
      `
      const deps = extractDepartments(html)
      const names = deps.map((d) => d.name.toLowerCase())

      expect(names).toEqual(expect.arrayContaining(['engineering', 'sales', 'marketing']))
      expect(deps.every((d) => d.confidence === 'high')).toBe(true)
    })

    it('extracts known russian department names from headings', () => {
      const html = `
        <h2>Разработка</h2>
        <h3>Маркетинг</h3>
        <h3>Продажи</h3>
      `
      const deps = extractDepartments(html)
      const names = deps.map((d) => d.name.toLowerCase())

      expect(names).toEqual(
        expect.arrayContaining(['разработка', 'маркетинг', 'продажи'])
      )
    })

    it('ignores headings that do not match known department keywords', () => {
      const html = '<h2>About us</h2><h3>Our story</h3>'
      expect(extractDepartments(html)).toEqual([])
    })
  })

  describe('career URL paths', () => {
    it('extracts departments from /careers/<dept> URLs as medium confidence', () => {
      const html = `
        <a href="/careers/engineering">Engineering jobs</a>
        <a href="https://acme.ru/jobs/sales">Sales jobs</a>
      `
      const deps = extractDepartments(html)
      const eng = findByName(deps, 'engineering')
      const sales = findByName(deps, 'sales')

      expect(eng?.confidence).toBe('medium')
      expect(sales?.confidence).toBe('medium')
    })

    it('extracts departments from /vacancies/<dept> and /rabota/<dept> paths', () => {
      const html = `
        <a href="/vacancies/marketing">Маркетинг</a>
        <a href="/rabota/finance">Финансы</a>
      `
      const deps = extractDepartments(html)
      const names = deps.map((d) => d.name.toLowerCase())

      expect(names).toEqual(expect.arrayContaining(['marketing', 'finance']))
    })
  })

  describe('data attributes', () => {
    it('extracts departments from data-department attributes as high confidence', () => {
      const html = `
        <div data-department="Engineering">...</div>
        <div data-department="HR">...</div>
      `
      const deps = extractDepartments(html)
      const eng = findByName(deps, 'engineering')
      const hr = findByName(deps, 'hr')

      expect(eng?.confidence).toBe('high')
      expect(hr?.confidence).toBe('high')
    })
  })

  describe('deduplication and confidence merge', () => {
    it('deduplicates by canonical name, keeping the highest confidence', () => {
      const html = `
        <h2>Engineering</h2>
        <a href="/careers/engineering">Open roles</a>
        <div data-department="engineering">team</div>
      `
      const deps = extractDepartments(html)
      const eng = deps.filter((d) => d.name.toLowerCase() === 'engineering')

      expect(eng.length).toBe(1)
      expect(eng[0].confidence).toBe('high')
    })

    it('treats russian and english variants as distinct departments', () => {
      const html = `
        <h2>Engineering</h2>
        <h2>Разработка</h2>
      `
      const deps = extractDepartments(html)
      expect(deps.length).toBe(2)
    })

    it('lowercases department names and trims whitespace', () => {
      const deps = extractDepartments('<h2>  ENGINEERING  </h2>')
      expect(deps[0].name).toBe('engineering')
    })
  })

  describe('rich career page', () => {
    it('extracts a diverse set of departments from a realistic career page', () => {
      const html = `
        <h1>Careers at Acme</h1>
        <section>
          <h2>Engineering</h2>
          <a href="/careers/engineering/backend">Backend</a>
        </section>
        <section>
          <h2>Sales</h2>
          <a href="/jobs/sales">Sales jobs</a>
        </section>
        <section>
          <h2>Marketing</h2>
        </section>
        <section data-department="HR">
          <h3>People & Culture</h3>
        </section>
      `
      const deps = extractDepartments(html)
      const names = new Set(deps.map((d) => d.name.toLowerCase()))

      expect(names.has('engineering')).toBe(true)
      expect(names.has('sales')).toBe(true)
      expect(names.has('marketing')).toBe(true)
      expect(names.has('hr')).toBe(true)
    })
  })
})
