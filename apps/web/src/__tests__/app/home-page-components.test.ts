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

  it('balances malformed nested registry quotes', () => {
    expect(cleanEmployerName('АО "ГОСТИНИЦА "СОВЕТСКАЯ"'))
      .toBe('АО «ГОСТИНИЦА «СОВЕТСКАЯ»»');
    expect(cleanEmployerName('ООО "Ромашка"'))
      .toBe('ООО «Ромашка»');
  });

  it('describes the public example honestly when live data can fall back to demo', () => {
    const [exampleQuestion] = buildFaqItems(true);

    expect(exampleQuestion.answer).toContain('явно показываем демо');
    expect(exampleQuestion.answer).not.toContain('показывает те же данные');
  });
});
