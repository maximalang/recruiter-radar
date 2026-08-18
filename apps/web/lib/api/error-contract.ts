import { NextResponse } from 'next/server';

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    correlationId: string;
  };
};

export function getCorrelationId(request?: Request): string {
  return (
    request?.headers.get('x-correlation-id') ||
    request?.headers.get('x-request-id') ||
    crypto.randomUUID()
  );
}

export function apiError(
  code: string,
  status: number,
  options?: { request?: Request; message?: string },
) {
  const payload: ApiErrorPayload = {
    error: {
      code,
      message: options?.message ?? 'Request failed',
      correlationId: getCorrelationId(options?.request),
    },
  };

  return NextResponse.json(payload, { status });
}
