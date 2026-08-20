/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LeadRow } from '@/app/leads/leads-page-content';
import type { LeadItem } from '@/lib/leads-data';

const baseLead = {
  id: 'lead-1',
  orgId: 'org-1',
  clientProfileId: 'profile-1',
  orgName: 'Ромашка',
  sourceExternalId: null,
  score: 320,
  confidenceGate: 'A',
  vacanciesCount: 4,
  distinctVacancyNamesCount: 3,
  latestPublishedAt: '2026-07-01T00:00:00Z',
  reasons: [],
  structuredReasons: [],
  whyNow: 'Hiring burst across 3 roles',
  lawfulContactPath: 'Карьерная страница',
  negativeSignals: [],
  opener: '',
  feedbackStatus: 'contacted',
  suppressedUntil: null,
  createdAt: '2026-06-01T00:00:00Z',
  sourceFamilies: ['career-pages'],
  evidenceTitles: ['Backend', 'DevOps'],
  locationNames: ['Москва'],
  hasAiHint: true,
  isForeignEmployer: false,
  foreignMatchedDomain: null,
  reviewStatus: 'auto_approved',
} as unknown as LeadItem;

describe('LeadRow V1-V6 decision-row contract', () => {
  it('renders the decision hierarchy through canonical row and confidence primitives', () => {
    const { container } = render(
      <LeadRow lead={baseLead} fitPreview={null} hiringMode="specialist" rank={1} />,
    );

    const row = container.querySelector('[data-lead-row="true"]');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute('data-ui', 'lead-row');
    expect(row?.textContent).toContain('01');
    expect(screen.getByRole('link', { name: 'Ромашка' })).toHaveAttribute('href', '/leads/lead-1');
    expect(screen.getByText('Hiring burst across 3 roles')).toBeInTheDocument();
    expect(row?.textContent).toContain('4 вакансии');
    expect(row?.textContent).toContain('1 источник');
    expect(container.querySelector('[aria-label="Сила сигнала 80"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Уверенность: высокая"]')).not.toBeNull();
    expect(container.querySelector('[data-ui="confidence-indicator"]')).toHaveTextContent('высокая');
    expect(screen.getByRole('link', { name: 'Открыть анализ компании Ромашка' })).toHaveAttribute('href', '/leads/lead-1');

    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText('Компания и контакты')).toBeNull();
    expect(screen.queryByText('Релевантные вакансии')).toBeNull();
    expect(screen.queryByText('Сигналы')).toBeNull();
    expect(container.querySelector('[data-legend]')).toBeNull();
  });

  it('keeps primary proof scan-friendly without a per-row evidence accordion', () => {
    const { container } = render(
      <LeadRow
        lead={{ ...baseLead, reasons: ['Карьерная страница обновлена'] } as unknown as LeadItem}
        fitPreview={{ icon: 'industry', text: 'Совпадает отрасль' }}
        hiringMode="specialist"
        rank={2}
      />,
    );

    expect(screen.getByText('Hiring burst across 3 roles')).toBeInTheDocument();
    expect(container.textContent).toContain('4 вакансии · 2 подтвержд.');
    expect(container.textContent).toContain('1 источник');
    expect(container.textContent).toContain('Совпадает отрасль');
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('[data-legend]')).toBeNull();
  });

  it('uses shared Russian pluralization for source-family counts', () => {
    const fiveSources = {
      ...baseLead,
      sourceFamilies: ['career-pages', 'hh', 'newsroom', 'registry', 'crm'],
    } as unknown as LeadItem;

    const { container } = render(
      <LeadRow lead={fiveSources} fitPreview={null} hiringMode="specialist" rank={5} />,
    );

    expect(container.textContent).toContain('5 источников');
    expect(container.textContent).not.toContain('5 источника');
  });

  it('keeps workflow status subordinate to the decision hierarchy', () => {
    const { container } = render(
      <LeadRow lead={baseLead} fitPreview={null} hiringMode="specialist" rank={3} />,
    );
    expect(container.textContent).toMatch(/В работе/i);
    expect(container.querySelector('[aria-label="Сила сигнала 80"]')).not.toBeNull();
  });

  it('renders foreign-employer and AI context as quiet metadata rather than score semantics', () => {
    const foreignLead = { ...baseLead, isForeignEmployer: true } as unknown as LeadItem;
    const { container } = render(
      <LeadRow lead={foreignLead} fitPreview={null} hiringMode="specialist" rank={4} />,
    );
    expect(container.textContent).toContain('иностранный работодатель');
    expect(container.textContent).toContain('ИИ-подсказка доступна');
    expect(container.querySelector('[aria-label="Сила сигнала 80"]')).not.toBeNull();
  });

  it('keeps an eight-company extreme-content working set scan-first and fully named', () => {
    const organizationNames = [
      'ООО Северо-Западный научно-производственный центр цифровой инфраструктуры и промышленной автоматизации',
      'Акционерное общество Инженерные системы транспорта и городской мобильности',
      'Группа компаний Национальная облачная платформа корпоративных данных',
      'ООО Центр разработки медицинских информационных систем и телеметрии',
      'АО Региональные энергетические цифровые решения',
      'ООО Производственные технологии роботизации и машинного зрения',
      'Компания Инфраструктура электронной коммерции и логистических сервисов',
      'ООО Лаборатория прикладной аналитики клиентского опыта и автоматизации',
    ];
    const longWhyNow = 'За последние дни одновременно появились несколько связанных вакансий, повторная публикация ключевой роли и независимое подтверждение расширения команды — окно для точечного контакта ограничено по времени.';

    const { container } = render(
      <div>
        {organizationNames.map((orgName, index) => (
          <LeadRow
            key={orgName}
            lead={{
              ...baseLead,
              id: `stress-lead-${index + 1}`,
              orgId: `stress-org-${index + 1}`,
              orgName,
              whyNow: longWhyNow,
              score: 268 + index * 7,
              vacanciesCount: index + 1,
              sourceFamilies: index % 2 === 0
                ? ['career-pages', 'hh', 'official-news']
                : ['career-pages'],
              evidenceTitles: [
                'Очень длинное название подтверждённой вакансии ведущего инженера распределённых платформ',
                'Повторная публикация роли руководителя направления разработки',
                'Официальное сообщение о расширении продуктовой команды',
              ],
              locationNames: ['Москва', 'Санкт-Петербург'],
              confidenceGate: index % 3 === 0 ? 'A' : index % 3 === 1 ? 'B' : 'C',
            } as unknown as LeadItem}
            fitPreview={index % 2 === 0 ? { icon: 'industry', text: 'Совпадает специализация агентства' } : null}
            hiringMode="specialist"
            rank={index + 1}
          />
        ))}
      </div>,
    );

    const rows = container.querySelectorAll('[data-lead-row="true"]');
    expect(rows).toHaveLength(8);
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(container.querySelectorAll('[data-ui="confidence-indicator"]')).toHaveLength(8);
    expect(container.querySelectorAll('[aria-label^="Сила сигнала "]')).toHaveLength(8);
    expect(container.textContent).toContain(longWhyNow);
    const styles = readFileSync(
      resolve(process.cwd(), 'app/leads/leads-workspace.module.css'),
      'utf8',
    );
    expect(styles).toContain('content:"Сила · "');
    for (const [index, orgName] of organizationNames.entries()) {
      expect(container.textContent).toContain(orgName);
      expect(rows[index]?.textContent).toContain(String(index + 1).padStart(2, '0'));
    }
  });
});
