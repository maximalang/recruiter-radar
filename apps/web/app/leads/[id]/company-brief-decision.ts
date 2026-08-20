export type CompanyBriefPrimaryAction = {
  href: string;
  label: string;
  external: boolean;
};

export type CompanyBriefDecision = {
  kind: 'contact' | 'career' | 'lawful-path' | 'investigate';
  recommendation: string;
  primaryAction: CompanyBriefPrimaryAction | null;
  confidenceContext: string;
};

export function deriveCompanyBriefDecision(input: {
  hasLawfulCorporateContact: boolean;
  lawfulContactPath: string | null;
  careerPageUrl: string | null;
  confidenceContext: string;
}): CompanyBriefDecision {
  if (input.hasLawfulCorporateContact) {
    return {
      kind: 'contact',
      recommendation: 'Начать с подтверждённого корпоративного контакта и сослаться на текущий сигнал найма.',
      primaryAction: {
        href: '#company-brief-contact',
        label: 'Перейти к контакту',
        external: false,
      },
      confidenceContext: input.confidenceContext,
    };
  }

  if (input.careerPageUrl) {
    return {
      kind: 'career',
      recommendation: 'Открыть карьерную страницу и найти корпоративный путь контакта вручную.',
      primaryAction: {
        href: input.careerPageUrl,
        label: 'Открыть карьерную страницу',
        external: true,
      },
      confidenceContext: input.confidenceContext,
    };
  }

  if (input.lawfulContactPath) {
    return {
      kind: 'lawful-path',
      recommendation: `Использовать безопасный путь контакта: ${input.lawfulContactPath}.`,
      primaryAction: null,
      confidenceContext: input.confidenceContext,
    };
  }

  return {
    kind: 'investigate',
    recommendation: 'Сначала подтвердить корпоративный путь контакта, затем выходить с предложением.',
    primaryAction: null,
    confidenceContext: input.confidenceContext,
  };
}
