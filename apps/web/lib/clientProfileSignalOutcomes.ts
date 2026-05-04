import type { HhDigestItem } from "./hhDigest";

export async function recordClientProfileDigestShownOutcomes(input: {
  clientProfileId: string;
  deliveryKind: string;
  items: readonly HhDigestItem[];
  pipelineRunId?: string | null;
  messageId?: number | null;
  feedbackSource?: string | null;
}): Promise<void> {
  void input;
}
