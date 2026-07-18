/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import LoginForm from '@/app/login/login-form'

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useActionState: () => [{ ok: false, error: 'Слишком много попыток. Повторите позже.' }, jest.fn(), false],
}))

jest.mock('@/app/login/actions', () => ({
  requestLoginAction: jest.fn(),
}))

describe('LoginForm', () => {
  it('announces a login error as an alert', () => {
    render(<LoginForm returnTo="/dashboard" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Слишком много попыток')
  })
})
