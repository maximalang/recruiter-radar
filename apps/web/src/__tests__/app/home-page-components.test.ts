import {
  buildFaqItems,
  buildPreviewEvidenceItems,
  cleanEmployerName,
} from '@/app/home-page-components';

describe('landing card copy helpers', () => {
  it('keeps evidence factual without repeating the why-now copy', () => {
    expect(buildPreviewEvidenceItems({
      whyNow: '246 вакансий, включая «A-HOTEL Fontanka 3*»',
      vacanciesCaption: '246 вакансий',
      evidenceTitles: [
        'A-HOTEL Fontanka 3*',
        'A-HOTEL Liner Airport 3*',
        'A-ОТЕЛЬ Лайнер Аэропорт 3*',
        'A-ОТЕЛЬ Фонтанка 3*',
        'A-HOTEL Hotel Park Krestovskiy',
      ],
      sourceFamilies: ['hh', 'hh'],
    })).toEqual([
      'Источник: hh.ru',
      'A-HOTEL Liner Airport 3*',
      'A-HOTEL Hotel Park Krestovskiy',
    ]);
  });

  it('strips the legal-form prefix and collapses double-nested registry quotes', () => {
    // Prod registry name with a legal prefix + a brand nested inside an outer
    // quote: the card should read like the hero example — the descriptive lead
    // + a single clean quote level, no "АО" boilerplate.
    expect(cleanEmployerName('АО "ГОСТИНИЦА "СОВЕТСКАЯ"'))
      .toBe('ГОСТИНИЦА «СОВЕТСКАЯ»');
    // Plain single-quote legal name: drop the prefix, keep the brand quoted.
    expect(cleanEmployerName('ООО "Ромашка"'))
      .toBe('«Ромашка»');
    // Real prod names sampled from the live preview — each must lose its prefix.
    expect(cleanEmployerName('ГУП «ЛЕНОБЛВОДОКАНАЛ»')).toBe('«ЛЕНОБЛВОДОКАНАЛ»');
    expect(cleanEmployerName('ФГБОУ ВО ЮУГМУ МИНЗДРАВА РОССИИ')).toBe('ЮУГМУ МИНЗДРАВА РОССИИ');
    expect(cleanEmployerName('ГБУЗ «МОСТОВСКАЯ ЦРБ» МЗ КК')).toBe('«МОСТОВСКАЯ ЦРБ» МЗ КК');
    expect(cleanEmployerName('ПАО «Газпром»')).toBe('«Газпром»');
    // A name with no prefix + no quotes is unchanged.
    expect(cleanEmployerName('Производственная компания')).toBe('Производственная компания');
    // Empty / whitespace is returned empty, not fabricated.
    expect(cleanEmployerName('   ')).toBe('');
  });

  it('describes the public example honestly when live data can fall back to demo', () => {
    const [exampleQuestion] = buildFaqItems(true);

    expect(exampleQuestion.answer).toContain('явно показываем демо');
    expect(exampleQuestion.answer).not.toContain('показывает те же данные');
  });

  it('answers trust, outreach and Telegram questions before checkout', () => {
    const faqItems = buildFaqItems(true);
    const faqCopy = faqItems.map((item) => `${item.question} ${item.answer}`).join(' ');

    expect(faqItems).toHaveLength(6);
    expect(faqCopy).toContain('Почему оценке можно доверять');
    expect(faqCopy).toContain('не отправляет сообщения автоматически');
    expect(faqCopy).toContain('Telegram');
  });
});
