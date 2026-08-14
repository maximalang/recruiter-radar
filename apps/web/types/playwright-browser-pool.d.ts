declare module "@/../../packages/db/scripts/adapters/playwright-browser-pool.mjs" {
  export function createPlaywrightBrowserPool(options?: {
    proxyUrls?: string[];
    navigationTimeoutMs?: number;
    defaultHeaders?: Record<string, string>;
    concurrency?: number;
    maxRequestsPerBrowser?: number;
    maxBrowserAgeMs?: number;
    idleBrowserTimeoutMs?: number;
    perHostMinIntervalMs?: number;
    perHostConcurrency?: number;
    maxQueueSize?: number;
    hostProfiles?: Record<string, { maxConcurrency?: number; minIntervalMs?: number }>;
    maxProcessRssBytes?: number;
    memoryUsage?: () => { rss: number };
    stuckPageTimeoutMs?: number;
    gracefulCloseTimeoutMs?: number;
    circuitFailureThreshold?: number;
    circuitResetMs?: number;
    accessFailureCooldownMs?: number;
    throttlingCooldownMs?: number;
    dnsLookup?: (hostname: string, options: { all: true; verbatim: true }) => Promise<Array<{
      address: string;
      family: number;
    }>>;
  }): {
    fetchPage(input: {
      url: string;
      timeoutMs?: number;
      headers?: Record<string, string>;
      previous?: { etag?: string; lastModified?: string };
      settleMs?: number;
    }): Promise<{
      url: string;
      status: number;
      html: string | null;
      rawHeaders: Record<string, string>;
      notModified: boolean;
      validators: { etag: string | null; lastModified: string | null };
      fetchedAt: string;
      warnings: string[];
    }>;
    close(): Promise<void>;
  };
}
