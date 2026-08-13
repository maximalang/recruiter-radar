declare module "@/../../packages/db/scripts/adapters/crawler-url-security.mjs" {
  export interface CrawlerUrlValidationResult {
    valid: boolean;
    reason?: string;
  }

  export function validateCrawlerUrl(url: string): CrawlerUrlValidationResult;
}
