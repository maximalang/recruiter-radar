import {
  extractContactPaths,
} from '@/lib/scoring/contact-paths'
import type { ContactPath } from '@/lib/scoring/contact-paths'

const findCategory = (paths: ContactPath[], category: ContactPath['category']) =>
  paths.filter((p) => p.category === category)

describe('extractContactPaths', () => {
  describe('email categorization', () => {
    it('classifies hiring-purpose mailboxes as hr-email with high confidence', () => {
      const html = `
        <p>Send your CV to <a href="mailto:hr@acme.ru">hr@acme.ru</a></p>
        <p>Or reach our recruiters at recruiting@acme.ru and talent@acme.ru</p>
      `
      const paths = extractContactPaths(html)
      const hrEmails = findCategory(paths, 'hr-email')

      expect(hrEmails.map((p) => p.value)).toEqual(
        expect.arrayContaining(['hr@acme.ru', 'recruiting@acme.ru', 'talent@acme.ru'])
      )
      expect(hrEmails.every((p) => p.confidence === 'high')).toBe(true)
    })

    it('classifies careers-prefixed mailboxes as careers-email', () => {
      const paths = extractContactPaths('Apply: careers@acme.ru or vacancy@acme.ru')
      const careers = findCategory(paths, 'careers-email')

      expect(careers.map((p) => p.value)).toEqual(
        expect.arrayContaining(['careers@acme.ru', 'vacancy@acme.ru'])
      )
      expect(careers.every((p) => p.confidence === 'high')).toBe(true)
    })

    it('classifies generic mailboxes as generic-email with medium confidence', () => {
      const paths = extractContactPaths('General: info@acme.ru, hello@acme.ru')
      const generic = findCategory(paths, 'generic-email')

      expect(generic.map((p) => p.value)).toEqual(
        expect.arrayContaining(['info@acme.ru', 'hello@acme.ru'])
      )
      expect(generic.every((p) => p.confidence === 'medium')).toBe(true)
    })

    it('classifies firstname.lastname-pattern mailboxes as personal-email with low confidence', () => {
      const paths = extractContactPaths('Owner: ivan.petrov@acme.ru — please do not spam')
      const personal = findCategory(paths, 'personal-email')

      expect(personal.map((p) => p.value)).toContain('ivan.petrov@acme.ru')
      expect(personal[0].confidence).toBe('low')
    })

    it('extracts mailto: hrefs even without surrounding plain text', () => {
      const html = '<a href="mailto:hr@acme.ru?subject=Job">Apply</a>'
      const paths = extractContactPaths(html)
      expect(paths.some((p) => p.value === 'hr@acme.ru' && p.category === 'hr-email')).toBe(true)
    })

    it('lowercases and deduplicates emails', () => {
      const html = 'HR@Acme.RU and hr@acme.ru and <a href="mailto:HR@acme.ru">link</a>'
      const paths = extractContactPaths(html)
      const matches = paths.filter((p) => p.value === 'hr@acme.ru')
      expect(matches.length).toBe(1)
    })
  })

  describe('phone numbers', () => {
    it('extracts russian-format phone numbers from text and tel: hrefs', () => {
      const html = `
        Phone: +7 (495) 123-45-67
        <a href="tel:+74951234568">Call</a>
      `
      const paths = extractContactPaths(html)
      const phones = findCategory(paths, 'phone')

      expect(phones.length).toBeGreaterThanOrEqual(2)
      expect(phones.every((p) => p.value.startsWith('+7'))).toBe(true)
    })

    it('normalizes phone numbers by removing spaces, dashes and parentheses', () => {
      const paths = extractContactPaths('+7 (495) 123-45-67')
      const phones = findCategory(paths, 'phone')
      expect(phones[0].value).toBe('+74951234567')
    })
  })

  describe('contact form URLs', () => {
    it('extracts /contact /contacts /feedback URLs', () => {
      const html = `
        <a href="https://acme.ru/contact">Contact us</a>
        <a href="/contacts">Связаться</a>
        <a href="https://acme.ru/feedback?ref=careers">Feedback</a>
      `
      const paths = extractContactPaths(html, 'https://acme.ru/careers')
      const forms = findCategory(paths, 'contact-form')

      expect(forms.length).toBeGreaterThanOrEqual(2)
      expect(forms.some((p) => /contact/.test(p.value))).toBe(true)
      expect(forms.some((p) => /feedback/.test(p.value))).toBe(true)
    })

    it('resolves relative contact URLs against the provided base URL', () => {
      const paths = extractContactPaths(
        '<a href="/contact">Contact</a>',
        'https://acme.ru/careers'
      )
      const forms = findCategory(paths, 'contact-form')
      expect(forms[0].value).toBe('https://acme.ru/contact')
    })
  })

  describe('messenger handles', () => {
    it('extracts telegram links as telegram category', () => {
      const html = '<a href="https://t.me/acme_hr">Telegram</a>'
      const paths = extractContactPaths(html)
      const tg = findCategory(paths, 'telegram')
      expect(tg[0].value).toBe('https://t.me/acme_hr')
    })

    it('extracts whatsapp links as whatsapp category', () => {
      const html = '<a href="https://wa.me/74951234567">WhatsApp</a>'
      const paths = extractContactPaths(html)
      const wa = findCategory(paths, 'whatsapp')
      expect(wa[0].value).toBe('https://wa.me/74951234567')
    })
  })

  describe('contract', () => {
    it('returns an empty array on empty input', () => {
      expect(extractContactPaths('')).toEqual([])
    })

    it('returns multiple paths for a rich career page', () => {
      const html = `
        <h1>Careers at Acme</h1>
        <p>HR: <a href="mailto:hr@acme.ru">hr@acme.ru</a></p>
        <p>Generic: info@acme.ru</p>
        <p>Phone: +7 (495) 123-45-67</p>
        <a href="/contact">Contact form</a>
        <a href="https://t.me/acme_hr">Telegram HR</a>
      `
      const paths = extractContactPaths(html, 'https://acme.ru/careers')
      const categories = new Set(paths.map((p) => p.category))

      expect(categories.has('hr-email')).toBe(true)
      expect(categories.has('generic-email')).toBe(true)
      expect(categories.has('phone')).toBe(true)
      expect(categories.has('contact-form')).toBe(true)
      expect(categories.has('telegram')).toBe(true)
    })
  })
})
