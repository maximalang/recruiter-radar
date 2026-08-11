/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: 'Не наш профиль' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'В работу' })).toBeDisabled();
    expect(mockUpdateLeadFeedback).not.toHaveBeenCalled();
  });

  it('submits an explicit null when the recruiter skips a typed note', async () => {
    mockUpdateLeadFeedback.mockResolvedValue({ feedbackStatus: 'badfit' });
    render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="none" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Не наш профиль' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Заметка к решению' }), {
      target: { value: 'Не должна сохраниться' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Без заметки' }));

    await waitFor(() => {
      expect(mockUpdateLeadFeedback).toHaveBeenCalledWith('10', '20', 'badfit', null);
    });
  });

  it('preserves the note draft when a skip mutation is rejected', async () => {
    mockUpdateLeadFeedback.mockRejectedValue(new Error('Повторите позже'));
    render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="none" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Не наш профиль' }));
    const note = screen.getByRole('textbox', { name: 'Заметка к решению' });
    fireEvent.change(note, { target: { value: 'Черновик для возможного Save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Без заметки' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Повторите позже');
    expect(mockUpdateLeadFeedback).toHaveBeenCalledWith('10', '20', 'badfit', null);
    expect(note).toHaveValue('Черновик для возможного Save');
  });

  it('keeps persisted status and the note draft recoverable after a rejected save', async () => {
    mockUpdateLeadFeedback.mockRejectedValue(new Error('Не удалось сохранить'));
    render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="replied" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Не наш профиль' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Заметка к решению' }), {
      target: { value: '  Слишком узкий профиль  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить');
    expect(mockUpdateLeadFeedback).toHaveBeenCalledWith(
      '10',
      '20',
      'badfit',
      'Слишком узкий профиль',
    );
    expect(screen.getByRole('button', { name: 'Ответили' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Не наш профиль' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('textbox', { name: 'Заметка к решению' })).toHaveValue(
      '  Слишком узкий профиль  ',
    );
  });

  it('holds a synchronous mutation lock across rapid repeated actions', () => {
    mockUpdateLeadFeedback.mockReturnValue(new Promise(() => {}));
    render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="none" />,
    );

    const action = screen.getByRole('button', { name: 'В работу' });
    act(() => {
      action.click();
      action.click();
    });

    expect(mockUpdateLeadFeedback).toHaveBeenCalledTimes(1);
  });

  it('keeps the submitted draft stable while a note mutation is pending', async () => {
    let resolveRequest!: (value: { feedbackStatus: string }) => void;
    mockUpdateLeadFeedback.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    const { container } = render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="none" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Не наш профиль' }));
    const note = screen.getByRole('textbox', { name: 'Заметка к решению' });
    fireEvent.change(note, { target: { value: '  Проверенный черновик  ' } });
    const save = screen.getByRole('button', { name: 'Сохранить' });
    const skip = screen.getByRole('button', { name: 'Без заметки' });
    act(() => {
      save.click();
      skip.click();
    });

    expect(mockUpdateLeadFeedback).toHaveBeenCalledTimes(1);
    expect(mockUpdateLeadFeedback).toHaveBeenCalledWith(
      '10',
      '20',
      'badfit',
      'Проверенный черновик',
    );
    expect(note).toBeDisabled();
    expect(note).toHaveValue('  Проверенный черновик  ');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      resolveRequest({ feedbackStatus: 'badfit' });
    });
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
    mockUpdateLeadFeedback
      .mockRejectedValueOnce(new Error('Временная ошибка'))
      .mockResolvedValueOnce({ feedbackStatus: 'contacted' });
    render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="none" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'В работу' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Временная ошибка');
    expect(screen.getByRole('button', { name: 'В работу' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'В работу' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'В работу' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Статус сохранён: В работу');
    });
    expect(mockUpdateLeadFeedback).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the server returns an unknown feedback status', async () => {
    mockUpdateLeadFeedback.mockResolvedValue({ feedbackStatus: 'unexpected' });
    render(
      <FeedbackButtons orgId="10" clientProfileId="20" currentStatus="none" />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'В работу' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Сервер вернул неизвестный статус обратной связи',
    );
    expect(screen.getByRole('button', { name: 'В работу' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
