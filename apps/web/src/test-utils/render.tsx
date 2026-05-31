/**
 * Test utilities for React component testing in jsdom environment.
 */
import type { RenderOptions } from '@testing-library/react';
import { render as rtlRender } from '@testing-library/react';
import React from 'react';

export function render(
  ui: React.ReactElement,
  options?: RenderOptions
) {
  return rtlRender(ui, { ...options });
}

export * from '@testing-library/react';
