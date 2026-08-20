import { deriveCompanyBriefDecision } from '../../../../app/leads/[id]/company-brief-decision';

describe('Company Brief decision presentation', () => {
  const confidenceContext = 'высокая уверенность';

  it('keeps the recommendation and primary action on the confirmed contact path', () => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: true,
      lawfulContactPath: 'публичный корпоративный email',
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

  it('uses the career page as both recommendation and CTA when no contact is known', () => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: false,
      lawfulContactPath: null,
      careerPageUrl: 'https://company.test/careers',
      confidenceContext,
    });

    expect(decision.kind).toBe('career');
    expect(decision.recommendation).toContain('Открыть карьерную страницу');
    expect(decision.primaryAction?.href).toBe('https://company.test/careers');
    expect(decision.primaryAction?.label).toBe('Открыть карьерную страницу');
  });

  it('does not manufacture a website CTA when no actionable URL exists', () => {
    const decision = deriveCompanyBriefDecision({
      hasLawfulCorporateContact: false,
      lawfulContactPath: 'форма на официальном сайте',
      careerPageUrl: null,
      confidenceContext,
    });

    expect(decision.kind).toBe('lawful-path');
    expect(decision.primaryAction).toBeNull();
  });
});
