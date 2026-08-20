import { deriveCompanyBriefDecision } from '../../../../app/leads/[id]/company-brief-decision';

describe('Company Brief decision presentation', () => {
  const confidenceContext = 'высокая уверенность';

  it('keeps the recommendation and primary action on the confirmed contact path', () => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: true,
      lawfulContactPathKind: 'corporate-contact',
      lawfulContactPathLabel: 'публичный корпоративный email',
      careerPageUrl: 'https://company.test/careers',
      confidenceContext,
    });

    expect(decision.kind).toBe('contact');
    expect(decision.recommendation).toContain('подтверждённого корпоративного контакта');
    expect(decision.primaryAction).toEqual({
      href: '#company-brief-contact',
      label: 'Перейти к контакту',
      external: false,
    });
    expect(decision.confidenceContext).toBe(confidenceContext);
  });

  it.each([
    ['corporate-contact', 'Корпоративная форма обратной связи или общий HR-email'],
    ['direct-surface', 'Прямая поверхность компании — официальный сайт или карьерный раздел'],
    ['registry-data', 'Данные из открытых реестров (ЕГРЮЛ/ФНС)'],
  ])('preserves a known non-career lawful path (%s) ahead of an unrelated career page', (
    lawfulContactPathKind,
    lawfulContactPathLabel,
  ) => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: false,
      lawfulContactPathKind,
      lawfulContactPathLabel,
      careerPageUrl: 'https://company.test/careers',
      confidenceContext,
    });

    expect(decision.kind).toBe('lawful-path');
    expect(decision.recommendation).toContain(lawfulContactPathLabel);
    expect(decision.primaryAction).toBeNull();
  });

  it('uses the career page as both recommendation and CTA when the lawful path itself is career-page', () => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: false,
      lawfulContactPathKind: 'career-page',
      lawfulContactPathLabel: 'Карьерная страница компании — прямой путь к HR',
      careerPageUrl: 'https://company.test/careers',
      confidenceContext,
    });

    expect(decision.kind).toBe('career');
    expect(decision.recommendation).toContain('Открыть карьерную страницу');
    expect(decision.primaryAction?.href).toBe('https://company.test/careers');
    expect(decision.primaryAction?.label).toBe('Открыть карьерную страницу');
  });

  it('uses a career page when no stronger lawful path exists', () => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: false,
      lawfulContactPathKind: null,
      lawfulContactPathLabel: null,
      careerPageUrl: 'https://company.test/careers',
      confidenceContext,
    });

    expect(decision.kind).toBe('career');
    expect(decision.primaryAction?.href).toBe('https://company.test/careers');
  });

  it('does not manufacture a CTA when a known lawful path has no concrete safe target', () => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: false,
      lawfulContactPathKind: 'direct-surface',
      lawfulContactPathLabel: 'форма на официальном сайте',
      careerPageUrl: null,
      confidenceContext,
    });

    expect(decision.kind).toBe('lawful-path');
    expect(decision.primaryAction).toBeNull();
  });

  it('keeps a career-page recommendation non-clickable when its URL is missing', () => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: false,
      lawfulContactPathKind: 'career-page',
      lawfulContactPathLabel: 'Карьерная страница компании — прямой путь к HR',
      careerPageUrl: null,
      confidenceContext,
    });

    expect(decision.kind).toBe('lawful-path');
    expect(decision.primaryAction).toBeNull();
  });

  it('falls back to investigation when nothing actionable is known', () => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: false,
      lawfulContactPathKind: null,
      lawfulContactPathLabel: null,
      careerPageUrl: null,
      confidenceContext,
    });

    expect(decision.kind).toBe('investigate');
    expect(decision.recommendation).toContain('подтвердить корпоративный путь контакта');
    expect(decision.primaryAction).toBeNull();
  });
});
