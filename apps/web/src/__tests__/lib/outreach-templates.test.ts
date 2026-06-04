/**
 * Tests for outreach template system.
 *
 * Verifies template rendering, variable substitution,
 * built-in templates, and length limits.
 */

import {
  renderOutreachTemplate,
  OUTREACH_TEMPLATES,
  type OutreachTemplate,
  type OutreachContext,
} from '@/lib/outreach-templates';

describe('outreach templates', () => {
  const baseContext: OutreachContext = {
    orgName: 'Яндекс',
    reasons: ['Активный найм', 'Несколько ролей'],
    vacancyCount: 5,
    roleNames: ['Backend Developer', 'Frontend Engineer'],
    sourceFamily: 'hh',
    locationName: 'Москва',
    confidenceGate: 'A',
  };

  describe('renderOutreachTemplate', () => {
    it('replaces {{orgName}} variable', () => {
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'Здравствуйте! По {{orgName}} видно...',
      };
      const result = renderOutreachTemplate(template, baseContext);
      expect(result).toContain('Яндекс');
      expect(result).not.toContain('{{orgName}}');
    });

    it('replaces {{reasons}} variable as comma-separated list', () => {
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'Видно, что {{reasons}}.',
      };
      const result = renderOutreachTemplate(template, baseContext);
      expect(result).toContain('Активный найм, Несколько ролей');
    });

    it('replaces {{vacancyCount}} variable', () => {
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'У компании {{vacancyCount}} вакансий.',
      };
      const result = renderOutreachTemplate(template, baseContext);
      expect(result).toContain('5 вакансий');
    });

    it('replaces {{roleNames}} variable as comma-separated list', () => {
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'Роли: {{roleNames}}.',
      };
      const result = renderOutreachTemplate(template, baseContext);
      expect(result).toContain('Backend Developer, Frontend Engineer');
    });

    it('replaces {{locationName}} variable', () => {
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'Город: {{locationName}}.',
      };
      const result = renderOutreachTemplate(template, baseContext);
      expect(result).toContain('Москва');
    });

    it('leaves unknown variables unchanged', () => {
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'Hello {{unknownVar}}!',
      };
      const result = renderOutreachTemplate(template, baseContext);
      expect(result).toContain('{{unknownVar}}');
    });

    it('handles empty arrays gracefully', () => {
      const ctx: OutreachContext = {
        ...baseContext,
        reasons: [],
        roleNames: [],
      };
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'Причины: {{reasons}}. Роли: {{roleNames}}.',
      };
      const result = renderOutreachTemplate(template, ctx);
      expect(result).toContain('Причины: .');
      expect(result).toContain('Роли: .');
    });

    it('truncates result to MAX_OUTREACH_LENGTH if exceeded', () => {
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'A'.repeat(600),
      };
      const result = renderOutreachTemplate(template, baseContext);
      expect(result.length).toBeLessThanOrEqual(500);
    });

    it('prefers sentence boundary when truncating', () => {
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'Short sentence. ' + 'B'.repeat(550) + '. More text.',
      };
      const result = renderOutreachTemplate(template, baseContext);
      expect(result.length).toBeLessThanOrEqual(500);
      // Should break at the first sentence, not mid-word
      expect(result).toContain('Short sentence.');
    });

    it('adds ellipsis when no sentence boundary found in second half', () => {
      const template: OutreachTemplate = {
        id: 'test',
        label: 'Test',
        body: 'X'.repeat(600),
      };
      const result = renderOutreachTemplate(template, baseContext);
      expect(result).toContain('…');
    });
  });

  describe('OUTREACH_TEMPLATES', () => {
    it('has at least 3 built-in templates', () => {
      expect(OUTREACH_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    });

    it('each template has id, label, and body', () => {
      for (const t of OUTREACH_TEMPLATES) {
        expect(t.id).toBeTruthy();
        expect(t.label).toBeTruthy();
        expect(t.body).toBeTruthy();
        expect(t.body.length).toBeGreaterThan(0);
      }
    });

    it('each template id is unique', () => {
      const ids = OUTREACH_TEMPLATES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('standard template renders with full context', () => {
      const standard = OUTREACH_TEMPLATES.find((t) => t.id === 'standard');
      expect(standard).toBeDefined();
      const result = renderOutreachTemplate(standard!, baseContext);
      expect(result).toContain('Яндекс');
      expect(result.length).toBeLessThanOrEqual(500);
    });

    it('short template renders concisely', () => {
      const short = OUTREACH_TEMPLATES.find((t) => t.id === 'short');
      expect(short).toBeDefined();
      const result = renderOutreachTemplate(short!, baseContext);
      expect(result.length).toBeLessThanOrEqual(300);
    });

    it('direct template renders for specific role', () => {
      const direct = OUTREACH_TEMPLATES.find((t) => t.id === 'direct');
      expect(direct).toBeDefined();
      const result = renderOutreachTemplate(direct!, baseContext);
      expect(result).toContain('Яндекс');
    });
  });
});
