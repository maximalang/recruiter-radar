// Database types with snake_case field names
export * from './db-types';

// Convert camelCase to snake_case for compatibility
export namespace DigestItemUtils {
  export function getOrgId(item: any): string {
    return item.org_id;
  }

  export function getSourceExternalId(item: any): string {
    return item.source_external_id;
  }

  export function getSourceDisplayName(item: any): string {
    return item.source_display_name;
  }

  export function getEvidenceTitles(item: any): string[] {
    return item.evidence_titles || [];
  }

  export function getLocationNames(item: any): string[] {
    return item.location_names || [];
  }

  export function getTotalScore(item: any): number {
    return item.total_score || 0;
  }

  export function getConfidenceGate(item: any): 'A' | 'B' | 'C' | 'D' {
    return item.confidence_gate || 'D';
  }
}