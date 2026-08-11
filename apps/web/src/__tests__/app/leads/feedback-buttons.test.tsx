/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FeedbackButtons from '@/app/leads/[id]/feedback-buttons';

const mockUpdateLeadFeedback = jest.fn();

jest.mock('@/app/leads/[id]/actions', () => ({
  updateLeadFeedbackAction: (...args: unknown[]) => mockUpdateLeadFeedback(...args),
}));

describe('FeedbackButtons motion and status feedback', () => {
  beforeEach(() => {
    mockUpdateLeadFeedback.mockReset();
  });

  it('moves focus into the optional note disclosure', () => {
    render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="none" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Не наш профиль' }));

    const note = screen.getByRole('textbox', { name: 'Заметка к решению' });
    expect(note).toHaveFocus();
    expect(note.closest('[data-motion-disclosure]')).not.toBeNull();
  });

  it('announces a saved status and confirms the semantic icon state', async () => {
    mockUpdateLeadFeedback.mockResolvedValue({ feedbackStatus: 'replied' });
    render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="none" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ответили' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Статус сохранён: Ответили');
    });
    const activeButton = screen.getByRole('button', { name: 'Ответили' });
    expect(activeButton.querySelector('[data-motion-icon="feedback"]')).toHaveAttribute(
      'data-motion-state',
      'success',
    );
  });

  it('keeps failures explicit and recoverable', async () => {
    mockUpdateLeadFeedback.mockRejectedValue(new Error('Временная ошибка'));
    render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="none" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'В работу' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Временная ошибка');
    expect(screen.getByRole('button', { name: 'В работу' })).toBeEnabled();
  });
});
