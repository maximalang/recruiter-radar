/**
 * @jest-environment jsdom
 *
 * D3 opener-draft block UI tests — the manual-send-only contract on the lead
 * detail page.
 *
 * Contract under test:
 *   - empty state offers ONLY generation (no draft, no copy).
 *   - a generated draft renders an editable textarea; the copy button does NOT
 *     exist until the human confirms.
 *   - confirm → the copy button appears; clicking it copies the CONFIRMED text
 *     to the clipboard (the only "send" in the product).
 *   - editing a confirmed draft hides the copy button and warns that saving
 *     resets the confirmation; saving flips the status back to draft.
 *   - action failures surface as a readable error, not a crash.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import OpenerDraftBlock from '@/app/leads/[id]/opener-draft-block';
import {
  confirmOpenerDraftAction,
  generateOpenerDraftAction,
  saveOpenerDraftEditsAction,
} from '@/app/leads/[id]/opener-actions';
import type { StoredOpenerDraft } from '@/lib/ai/opener/openerDraftStore';

jest.mock('@/app/leads/[id]/opener-actions', () => ({
  generateOpenerDraftAction: jest.fn(),
  saveOpenerDraftEditsAction: jest.fn(),
  confirmOpenerDraftAction: jest.fn(),
}));

const mockGenerate = jest.mocked(generateOpenerDraftAction);
const mockSave = jest.mocked(saveOpenerDraftEditsAction);
const mockConfirm = jest.mocked(confirmOpenerDraftAction);

// Clipboard stubs — same pattern as next-steps-block.test.tsx.
const writeText = jest.fn(() => Promise.resolve());
Object.defineProperty(globalThis, 'navigator', {
  value: { ...globalThis.navigator, clipboard: { writeText } },
  writable: true,
});
Object.defineProperty(window, 'isSecureContext', {
  value: true,
  writable: true,
});

const DRAFT_TEXT = 'Здравствуйте! По ООО Ромашка видно, что идёт активный найм.';

function storedDraft(overrides: Partial<StoredOpenerDraft> = {}): StoredOpenerDraft {
  return {
    schemaVersion: 1,
    draft: DRAFT_TEXT,
    currentText: DRAFT_TEXT,
    status: 'draft',
    provider: 'codexoid',
    model: 'codexoid/test-model',
    promptVersion: 'opener-draft-v1',
    traceId: 'trace-1',
    generatedAt: '2026-10-01T12:00:00.000Z',
    editedAt: null,
    confirmedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  writeText.mockClear();
});

describe('OpenerDraftBlock — empty state', () => {
  it('offers generation only; no editor and no copy path', () => {
    render(<OpenerDraftBlock candidateId="55" initialDraft={null} />);
    expect(screen.getByRole('button', { name: /сгенерировать черновик/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/текст черновика/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /скопировать/i })).toBeNull();
    // AI attribution + manual-send disclaimer are visible before any generation.
    expect(screen.getByText(/ничего не отправляет автоматически/i)).toBeInTheDocument();
  });

  it('renders the draft lifecycle after a successful generation', async () => {
    mockGenerate.mockResolvedValue(storedDraft());
    render(<OpenerDraftBlock candidateId="55" initialDraft={null} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /сгенерировать черновик/i }));
    });

    expect(mockGenerate).toHaveBeenCalledWith('55');
    const editor = screen.getByLabelText(/текст черновика/i) as HTMLTextAreaElement;
    expect(editor.value).toBe(DRAFT_TEXT);
    expect(screen.getByText('Черновик')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^подтвердить$/i })).toBeEnabled();
    // Not confirmed yet → no copy button.
    expect(screen.queryByRole('button', { name: /скопировать текст/i })).toBeNull();
    // Provenance attribution.
    expect(screen.getByText(/codexoid\/test-model/)).toBeInTheDocument();
  });

  it('shows a readable error when generation fails', async () => {
    mockGenerate.mockRejectedValue(new Error('ИИ-черновик сейчас недоступен. Попробуйте позже.'));
    render(<OpenerDraftBlock candidateId="55" initialDraft={null} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /сгенерировать черновик/i }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/недоступен/i);
    expect(screen.queryByLabelText(/текст черновика/i)).toBeNull();
  });
});

describe('OpenerDraftBlock — confirm → manual copy', () => {
  it('shows the copy button only for a confirmed draft and copies the confirmed text', async () => {
    render(
      <OpenerDraftBlock
        candidateId="55"
        initialDraft={storedDraft({ status: 'confirmed', confirmedAt: '2026-10-01T12:10:00.000Z' })}
      />,
    );

    expect(screen.getByText('Подтверждён')).toBeInTheDocument();
    const copyBtn = screen.getByRole('button', { name: /скопировать текст/i });

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeText).toHaveBeenCalledWith(DRAFT_TEXT);
    expect(screen.getByRole('button', { name: /скопировано/i })).toBeInTheDocument();
    // No action server call was made by copying — it is purely client-side.
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('confirm from the UI flips the status and reveals the copy button', async () => {
    mockConfirm.mockResolvedValue(storedDraft({ status: 'confirmed', confirmedAt: '2026-10-01T12:10:00.000Z' }));
    render(<OpenerDraftBlock candidateId="55" initialDraft={storedDraft()} />);

    expect(screen.queryByRole('button', { name: /скопировать текст/i })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^подтвердить$/i }));
    });

    expect(mockConfirm).toHaveBeenCalledWith('55');
    expect(screen.getByRole('button', { name: /скопировать текст/i })).toBeInTheDocument();
  });
});

describe('OpenerDraftBlock — edits reset confirmation', () => {
  it('hides the copy path while a confirmed draft has unsaved edits, and saving drops the status to draft', async () => {
    mockSave.mockResolvedValue(
      storedDraft({
        currentText: 'Отредактированный текст',
        status: 'draft',
        editedAt: '2026-10-01T12:20:00.000Z',
        confirmedAt: null,
      }),
    );
    render(
      <OpenerDraftBlock
        candidateId="55"
        initialDraft={storedDraft({ status: 'confirmed', confirmedAt: '2026-10-01T12:10:00.000Z' })}
      />,
    );

    const editor = screen.getByLabelText(/текст черновика/i) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Отредактированный текст' } });

    // Unsaved edits on a confirmed draft: copy disappears, confirm is disabled,
    // the hint explains that saving resets the confirmation.
    expect(screen.queryByRole('button', { name: /скопировать текст/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^подтвердить$/i })).toBeDisabled();
    expect(screen.getByText(/подтверждение сбрасывается/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /сохранить правки/i }));
    });

    expect(mockSave).toHaveBeenCalledWith('55', 'Отредактированный текст');
    expect(screen.getByText('Черновик')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /скопировать текст/i })).toBeNull();
    // Confirm is actionable again for the edited text.
    expect(screen.getByRole('button', { name: /^подтвердить$/i })).toBeEnabled();
  });

  it('keeps the save button disabled while the text is unchanged', () => {
    render(<OpenerDraftBlock candidateId="55" initialDraft={storedDraft()} />);
    expect(screen.getByRole('button', { name: /сохранить правки/i })).toBeDisabled();
  });
});
