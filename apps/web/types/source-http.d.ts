declare module "@/../../packages/db/scripts/adapters/source-http.mjs" {
  export class SourceHttpError extends Error {
    url?: string;
    status?: number;
    statusText?: string;
    attempt?: number;
  }

  export type SourceHttpOptions = RequestInit & {
    sourceName?: string;
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
    retryStatuses?: Set<number>;
    nodeHttpFallback?: boolean;
    preferNodeHttpFallback?: boolean;
  };

  export function fetchJson(
    url: string,
    options?: SourceHttpOptions,
  ): Promise<unknown>;

  export function fetchText(
    url: string,
    options?: SourceHttpOptions,
  ): Promise<{ response: Response; body: string }>;

  export function fetchWithSourcePolicy(
    url: string,
    options?: SourceHttpOptions,
  ): Promise<Response>;
}
