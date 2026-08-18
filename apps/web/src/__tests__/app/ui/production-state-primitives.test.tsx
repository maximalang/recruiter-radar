/** @jest-environment jsdom */
import type { SVGProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { ProductErrorState } from '@/app/ui/product-error-state';
import { DynamicStatusMessage, StaticEmptyState } from '@/app/ui/static-empty-state';

function TestIcon(props: SVGProps<SVGSVGElement>) {
  return <svg data-testid="empty-icon" {...props} />;
}

describe('production state primitives', () => {
  it('keeps static empty states out of live regions', () => {
    const { container } = render(
      <StaticEmptyState
        icon={TestIcon}
        title="Очередь пуста"
        description="Новых кандидатов для проверки нет."
      />,
    );

    expect(screen.getByRole('heading', { name: 'Очередь пуста' })).toBeTruthy();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('empty-icon')).toHaveAttribute('aria-hidden', 'true');
  });

  it('announces dynamic status messages politely', () => {
    render(<DynamicStatusMessage>Синхронизация завершена</DynamicStatusMessage>);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('renders safe correlation details and executes an explicit retry action', () => {
    const onClick = jest.fn();

    render(
      <ProductErrorState
        title="Данные временно недоступны"
        description="Повторите запрос."
        correlationId="req-123"
        retryAction={{ label: 'Повторить', onClick }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Код обращения: req-123');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
