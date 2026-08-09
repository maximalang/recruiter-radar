export const ANALYTICS_CONSENT_STORAGE_KEY = "rr_analytics_consent";
export const ANALYTICS_CONSENT_POLICY_VERSION = 2;
export const ANALYTICS_CONSENT_CHANGED_EVENT = "rr:analytics-consent-changed";
export const ANALYTICS_SETTINGS_OPEN_EVENT = "rr:open-analytics-settings";

export type AnalyticsConsentRecord = {
  analytics: boolean;
  policyVersion: typeof ANALYTICS_CONSENT_POLICY_VERSION;
  updatedAt: string;
};

let volatileConsent: boolean | null = null;

export function readAnalyticsConsent(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    if (!raw) return volatileConsent;
    const parsed = JSON.parse(raw) as Partial<AnalyticsConsentRecord>;
    if (
      typeof parsed.analytics !== "boolean"
      || parsed.policyVersion !== ANALYTICS_CONSENT_POLICY_VERSION
      || typeof parsed.updatedAt !== "string"
    ) {
      volatileConsent = null;
      return null;
    }
    volatileConsent = parsed.analytics;
    return parsed.analytics;
  } catch {
    return volatileConsent;
  }
}

export function clearAnalyticsConsent() {
  volatileConsent = null;
  try {
    window.localStorage.removeItem(ANALYTICS_CONSENT_STORAGE_KEY);
  } catch {
    // Volatile state is still cleared when storage is unavailable.
  }
}

export function storeAnalyticsConsent(analytics: boolean) {
  volatileConsent = analytics;
  const record: AnalyticsConsentRecord = {
    analytics,
    policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // The choice still applies to this document when persistent storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_CHANGED_EVENT, { detail: record }));
}
