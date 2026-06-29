/**
 * Premium evidence-first Telegram lead card (formatTelegramLeadMessage).
 *
 * Contract (spec S2): rich HTML card mirroring /leads/[id] — company →
 * readiness/score/gate → why now → role signal → location → safe contact path →
 * corporate surface → sources. Every company/user-derived string is HTML-escaped.
 * When evidence fields are absent it falls back to a compact (still premium,
 * never raw key:value) card. We assert structure, escaping, and the A/B-vs-C
 * readiness split — not exact whitespace.
 */

import {
  formatTelegramLeadMessage,
  type TelegramLeadMessage,
} from '../../../lib/telegram';

function baseRichLead(overrides: Partial<TelegramLeadMessage> = {}): TelegramLeadMessage {
  return {
    orgName: 'Ромашка',
    status: 'new',
    score: 3.2,
    lastSignalAt: '2026-06-20T10:00:00.000Z',
    userName: 'Агентство',
    confidence_gate: 'A',
    whyNow: 'Открыли 4 новые вакансии за неделю',
    evidenceTitles: ['Менеджер по продажам', 'Аналитик', 'HR-бизнес-партнёр', 'Юрист'],
    vacanciesCount: 6,
    lawfulContactPath: 'Карьерная страница компании — прямой путь к HR',
    sourceFamilies: ['career-pages', 'habr'],
    locationNames: ['Москва', 'Санкт-Петербург'],
    orgDomain: 'romashka.ru',
    careerPageUrl: 'https://romashka.ru/career',
    ...overrides,
  };
}

describe('formatTelegramLeadMessage — rich card', () => {
  it('renders the full evidence-first hierarchy', () => {
    const text = formatTelegramLeadMessage(baseRichLead());

    expect(text).toContain('<b>Ромашка</b>');
    // Gate A → "ready to reach out" readiness, score formatted to one decimal
    expect(text).toContain('Готов к контакту');
    expect(text).toContain('3.2');
    expect(text).toContain('· A');
    // Why now
    expect(text).toContain('Почему сейчас');
    expect(text).toContain('Открыли 4 новые вакансии за неделю');
    // Role signal: first 3 titles + "+N" overflow + vacancy count
    expect(text).toContain('Менеджер по продажам, Аналитик, HR-бизнес-партнёр');
    expect(text).toContain('+1');
    expect(text).toContain('(6 вак.)');
    // Location: first only (mobile-tight)
    expect(text).toContain('📍 Москва');
    expect(text).not.toContain('Санкт-Петербург');
    // Safe contact path + corporate surface (career page wins over domain)
    expect(text).toContain('Карьерная страница компании');
    expect(text).toContain('https://romashka.ru/career');
    // Sources line
    expect(text).toContain('career-pages, habr');
  });

  it('splits readiness: gate C is "на проверку", not "готов"', () => {
    const text = formatTelegramLeadMessage(baseRichLead({ confidence_gate: 'C' }));
    expect(text).toContain('На проверку');
    expect(text).not.toContain('Готов к контакту');
  });

  it('falls back to domain surface when career page is absent', () => {
    const text = formatTelegramLeadMessage(
      baseRichLead({ careerPageUrl: null, orgDomain: 'romashka.ru' }),
    );
    expect(text).toContain('https://romashka.ru');
    expect(text).not.toContain('/career');
  });

  it('HTML-escapes company name and evidence titles', () => {
    const text = formatTelegramLeadMessage(
      baseRichLead({
        orgName: 'Romashka & Co <Group>',
        evidenceTitles: ['Dev <senior> & QA'],
      }),
    );
    expect(text).toContain('Romashka &amp; Co &lt;Group&gt;');
    expect(text).toContain('Dev &lt;senior&gt; &amp; QA');
    // No raw unescaped angle bracket from user data leaks into the markup
    expect(text).not.toContain('<Group>');
  });
});

describe('formatTelegramLeadMessage — compact fallback', () => {
  it('used when no evidence fields are present', () => {
    const text = formatTelegramLeadMessage({
      orgName: 'Пустышка',
      status: 'new',
      score: 2,
      lastSignalAt: '2026-06-20T10:00:00.000Z',
      userName: 'Агентство',
      confidence_gate: 'B',
    });

    expect(text).toContain('<b>Пустышка</b>');
    // Score 2 → "2.0"
    expect(text).toContain('2.0');
    // No rich sections
    expect(text).not.toContain('Почему сейчас');
    expect(text).not.toContain('Источники');
    // Compact card still shows the signal timestamp line
    expect(text).toContain('Сигнал');
  });

  it('escapes the company name in the compact card too', () => {
    const text = formatTelegramLeadMessage({
      orgName: 'A & <B>',
      status: 'new',
      score: null,
      lastSignalAt: null,
      userName: 'Агентство',
    });
    expect(text).toContain('A &amp; &lt;B&gt;');
    // null score renders as em dash, not "null"
    expect(text).toContain('—');
  });
});

describe('formatTelegramLeadMessage — score band + why-match + AI hint', () => {
  it('labels a score >= 3 as hot', () => {
    const text = formatTelegramLeadMessage(baseRichLead({ score: 3.5 }));
    expect(text).toContain('Горячий');
  });

  it('labels a score in [2,3) as warm', () => {
    const text = formatTelegramLeadMessage(baseRichLead({ score: 2.4 }));
    expect(text).toContain('Тёплый');
  });

  it('labels a score below 2 as cold', () => {
    const text = formatTelegramLeadMessage(baseRichLead({ score: 1.2 }));
    expect(text).toContain('Холодный');
  });

  it('renders why-this-match lines when provided', () => {
    const text = formatTelegramLeadMessage(
      baseRichLead({ whyMatch: ['Нанимают по вашему профилю: Продажи', 'Регион: Москва'] }),
    );
    expect(text).toContain('Почему вам');
    expect(text).toContain('Нанимают по вашему профилю: Продажи');
    expect(text).toContain('Регион: Москва');
  });

  it('renders the AI hint with an explicit AI label and escapes it', () => {
    const text = formatTelegramLeadMessage(
      baseRichLead({ aiHint: 'Активный найм в команду <Eng>' }),
    );
    expect(text).toContain('AI-подсказка');
    expect(text).toContain('Активный найм в команду &lt;Eng&gt;');
  });

  it('omits why-match and AI sections when absent', () => {
    const text = formatTelegramLeadMessage(baseRichLead());
    expect(text).not.toContain('Почему вам');
    expect(text).not.toContain('AI-подсказка');
  });
});
