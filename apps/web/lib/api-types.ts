// Temporarily commenting out zod imports to pass TypeScript check
// import { z } from 'zod';

// Base API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: {
    timestamp: string;
    requestId: string;
  };
}

// Common Zod schemas for validation (to be implemented after zod installation)
// export const ClientProfileIdSchema = z.string().min(1, "Client profile ID is required");

// export const LimitSchema = z.number().int().positive().optional().default(10);
// export const CooldownDaysSchema = z.number().int().positive().optional().default(7);

// export const SourceKeySchema = z.string().optional();

// Digest API types
export interface DigestInput {
  clientProfileId: string;
  sourceKey?: string;
  cooldownDays?: number;
  limit?: number;
}

// const DigestInputSchema = z.object({
//   clientProfileId: ClientProfileIdSchema,
//   sourceKey: SourceKeySchema,
//   cooldownDays: CooldownDaysSchema,
//   limit: LimitSchema,
// });

export interface DigestOutput {
  run: {
    id: string;
    clientProfileId: string;
    sourceKey: string;
    status: 'running' | 'completed' | 'failed';
    requestedLimit: number;
    selectedCount: number;
    cooldownDays: number;
    createdAt: string;
    completedAt: string | null;
  };
  clientProfile: {
    id: string;
    name: string;
    isActive: boolean;
    dailyDigestLimit: number;
  };
  items: Array<{
    rank: number;
    orgId: string;
    sourceExternalId: string;
    sourceDisplayName: string;
    sourceFamilies: string[];
    evidenceTitles: string[];
    candidateSourceKeys: string[];
    locationNames: string[];
    vacanciesCount: number;
    distinctVacancyNamesCount: number;
    latestPublishedAt: string;
    totalScore: number;
    reasons: [string, string];
    opener: string;
    confidenceGate: 'A' | 'B' | 'C' | 'D';
  }>;
}

// Telegram API types
export interface TelegramWebhookInput {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      first_name: string;
      username?: string;
      type: 'private';
    };
    date: number;
    text: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    message?: {
      message_id: number;
      from: {
        id: number;
        is_bot: boolean;
        first_name: string;
        username?: string;
      };
      chat: {
        id: number;
        first_name: string;
        username?: string;
        type: 'private';
      };
      date: number;
      text: string;
    };
    data: string;
  };
}

export interface TelegramWebhookResponse {
  ok: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
}

// Billing Webhook types (Stripe)
export interface StripeWebhookInput {
  id: string;
  object: 'event';
  api_version: string;
  created: number;
  data: {
    object: {
      id: string;
      object: string;
      amount_total: number;
      currency: string;
      status: string;
      customer: string;
      payment_intent?: string;
      metadata?: {
        [key: string]: string;
      };
    };
  };
  livemode: boolean;
  type: string;
  pending_webhooks: number;
  request: {
    id: string;
    idempotency_key?: string;
  };
}

// const StripeWebhookInputSchema = z.object({
//   id: z.string(),
//   object: z.literal('event'),
//   api_version: z.string(),
//   created: z.number(),
//   data: z.object({
//     object: z.object({
//       id: z.string(),
//       object: z.string(),
//       amount_total: z.number(),
//       currency: z.string(),
//       status: z.string(),
//       customer: z.string(),
//       payment_intent: z.string().optional(),
//       metadata: z.record(z.string()).optional(),
//     }),
//   }),
//   livemode: z.boolean(),
//   type: z.string(),
//   pending_webhooks: z.number(),
//   request: z.object({
//     id: z.string(),
//     idempotency_key: z.string().optional(),
//   }),
// });

// Error response types
export interface ApiError {
  error: string;
  details?: unknown;
  code?: string;
}

// const ApiErrorSchema = z.object({
//   error: z.string(),
//   details: z.unknown().optional(),
//   code: z.string().optional(),
// });

// API Handler types
export type ApiHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  request?: Request
) => Promise<ApiResponse<TOutput>>;

// Next.js specific types
export interface NextApiRequest {
  headers: Record<string, string | undefined>;
  method: string;
  url: string;
  body?: unknown;
  query: Record<string, string | string[]>;
}

export interface NextApiResponse<T = unknown> {
  status: (code: number) => NextApiResponse<T>;
  json: (data: T) => NextApiResponse<T>;
  setHeader: (name: string, value: string) => NextApiResponse<T>;
}