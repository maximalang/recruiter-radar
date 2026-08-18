import { NextResponse } from 'next/server';

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    correlationId: string;
  };
};

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function readTrustedCorrelationId(request?: Request): string | null {
  const candidate =
    request?.headers.get('x-correlation-id') || request?.headers.get('x-request-id');

  if (!candidate) return null;

  const normalized = candidate.trim();
  return CORRELATION_ID_PATTERN.test(normalized) ? normalized : null;
}

function createCorrelationId(): string {
  const runtimeCrypto = globalThis.crypto;

  if (typeof runtimeCrypto?.randomUUID === 'function') {
    return runtimeCrypto.randomUUID();
  }

  if (typeof runtimeCrypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    runtimeCrypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return `rr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getCorrelationId(request?: Request): string {
  return readTrustedCorrelationId(request) ?? createCorrelationId();
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
