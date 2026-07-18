/** @jest-environment jsdom */

import { act, render } from '@testing-library/react';

import LiveClock from '../../../../app/dashboard/live-clock';

describe('LiveClock', () => {
  const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  afterEach(() => {
    jest.useRealTimers();
    if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
  });

  it('keeps one scheduled tick when visibility changes', () => {
    const { unmount } = render(<LiveClock />);
    expect(jest.getTimerCount()).toBe(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(jest.getTimerCount()).toBe(0);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(jest.getTimerCount()).toBe(1);

    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
