import {
  toContactPathViews,
  hasCorporateContact,
} from '@/lib/leads/contact-display'

describe('contact-display', () => {
  describe('toContactPathViews', () => {
    it('builds labeled, linkable rows for each category', () => {
      const views = toContactPathViews([
        { category: 'hr-email', value: 'hr@acme.ru' },
        { category: 'phone', value: '+74951234567' },
        { category: 'telegram', value: 'https://t.me/acme_hr' },
        { category: 'contact-form', value: 'https://acme.ru/contacts' },
      ])

      expect(views).toHaveLength(4)
      expect(views[0]).toEqual({
        category: 'hr-email',
        value: 'hr@acme.ru',
        isHiringSurface: true,
        label: 'HR-почта',
        display: 'HR-почта: hr@acme.ru',
        href: 'mailto:hr@acme.ru',
      })
      // Phone href strips separators to a tel: URI.
      expect(views[1].href).toBe('tel:+74951234567')
      expect(views[1].isHiringSurface).toBe(false)
      // Telegram is an external https link.
      expect(views[2].href).toBe('https://t.me/acme_hr')
      expect(views[2].label).toBe('Telegram')
      // Contact form is an external https link.
      expect(views[3].href).toBe('https://acme.ru/contacts')
      expect(views[3].label).toBe('Форма обратной связи')
    })

    it('marks hr-email and careers-email as hiring surfaces, generic-email not', () => {
      const views = toContactPathViews([
        { category: 'hr-email', value: 'hr@acme.ru' },
        { category: 'careers-email', value: 'vacancy@acme.ru' },
        { category: 'generic-email', value: 'info@acme.ru' },
      ])
      expect(views[0].isHiringSurface).toBe(true)
      expect(views[1].isHiringSurface).toBe(true)
      expect(views[2].isHiringSurface).toBe(false)
    })

    it('returns [] for non-array / empty input (honest empty state)', () => {
      expect(toContactPathViews([])).toEqual([])
      expect(toContactPathViews(undefined as never)).toEqual([])
    })

    it('falls through with a generic label for an unknown category', () => {
      const views = toContactPathViews([{ category: 'carrier-pigeon', value: ' coop 4' }])
      expect(views[0].label).toBe('Контакт')
      expect(views[0].href).toBeNull()
    })
  })

  describe('hasCorporateContact', () => {
    it('true for HR / careers / generic email or contact-form', () => {
      expect(hasCorporateContact([{ category: 'hr-email', value: 'hr@x.ru' }])).toBe(true)
      expect(hasCorporateContact([{ category: 'careers-email', value: 'vacancy@x.ru' }])).toBe(true)
      expect(hasCorporateContact([{ category: 'generic-email', value: 'info@x.ru' }])).toBe(true)
      expect(hasCorporateContact([{ category: 'contact-form', value: 'https://x.ru/contacts' }])).toBe(true)
    })

    it('false for personal-only / phone / messenger surfaces', () => {
      expect(hasCorporateContact([{ category: 'personal-email', value: 'ivan.petrov@x.ru' }])).toBe(false)
      expect(hasCorporateContact([{ category: 'phone', value: '+74951234567' }])).toBe(false)
      expect(hasCorporateContact([{ category: 'telegram', value: 'https://t.me/x' }])).toBe(false)
    })

    it('false for empty / non-array (no corporate surface found)', () => {
      expect(hasCorporateContact([])).toBe(false)
      expect(hasCorporateContact(undefined as never)).toBe(false)
    })
  })
})
