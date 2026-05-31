/**
 * Tests for Russian keywords in categorizeRole — T2.4
 *
 * hiring-pattern-detector.categorizeRole should handle Russian vacancy titles
 * for the Russia-first product.
 */

// The method is private static, so we test via the public analyzeVacancies path
// or by making it accessible. Let's use a direct test approach.

import { HiringPatternDetector } from '@/lib/lead-discovery/hiring-pattern-detector'

// Access the private static method via (HiringPatternDetector as any)
const categorizeRole = (roleName: string) =>
  (HiringPatternDetector as any).categorizeRole(roleName)

describe('T2.4: categorizeRole with Russian keywords', () => {
  describe('tech roles', () => {
    it('разработчик → tech', () => {
      expect(categorizeRole('Старший разработчик')).toBe('tech')
    })
    it('программист → tech', () => {
      expect(categorizeRole('Программист Python')).toBe('tech')
    })
    it('инженер → tech (not director/head)', () => {
      expect(categorizeRole('Инженер-программист')).toBe('tech')
    })
    it('архитектор → tech', () => {
      expect(categorizeRole('Архитектор систем')).toBe('tech')
    })
    it('devops → tech', () => {
      expect(categorizeRole('DevOps инженер')).toBe('tech')
    })
  })

  describe('management roles', () => {
    it('руководитель → management', () => {
      expect(categorizeRole('Руководитель проектов')).toBe('management')
    })
    it('директор → management', () => {
      expect(categorizeRole('Директор по развитию')).toBe('management')
    })
    it('заведующий → management', () => {
      expect(categorizeRole('Заведующий отделом')).toBe('management')
    })
    it('начальник → management', () => {
      expect(categorizeRole('Начальник отдела')).toBe('management')
    })
  })

  describe('hr roles', () => {
    it('рекрутер → hr', () => {
      expect(categorizeRole('Рекрутер')).toBe('hr')
    })
    it('HR-менеджер → hr', () => {
      expect(categorizeRole('HR-менеджер')).toBe('hr')
    })
    it('специалист по подбору → hr', () => {
      expect(categorizeRole('Специалист по подбору персонала')).toBe('hr')
    })
    it('кадровик → hr', () => {
      expect(categorizeRole('Кадровик')).toBe('hr')
    })
  })

  describe('sales roles', () => {
    it('менеджер по продажам → sales', () => {
      expect(categorizeRole('Менеджер по продажам')).toBe('sales')
    })
    it('коммерческий директор → sales', () => {
      expect(categorizeRole('Коммерческий директор')).toBe('sales')
    })
  })

  describe('finance roles', () => {
    it('бухгалтер → finance', () => {
      expect(categorizeRole('Бухгалтер')).toBe('finance')
    })
    it('финансовый → finance', () => {
      expect(categorizeRole('Финансовый аналитик')).toBe('finance')
    })
    it('аудитор → finance', () => {
      expect(categorizeRole('Аудитор')).toBe('finance')
    })
  })

  describe('English keywords still work', () => {
    it('developer → tech', () => {
      expect(categorizeRole('Senior Developer')).toBe('tech')
    })
    it('recruiter → hr', () => {
      expect(categorizeRole('Technical Recruiter')).toBe('hr')
    })
    it('sales manager → sales', () => {
      expect(categorizeRole('Sales Manager')).toBe('sales')
    })
  })
})
