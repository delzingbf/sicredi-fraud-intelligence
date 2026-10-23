import { z } from 'zod';

/**
 * Zod schema for POST /investigations request body.
 *
 * Design decisions:
 *   - transactionId only: customerId, amount, timestamp etc. are resolved by the
 *     backend from DataService (Dev A). Accepting them from the client would let
 *     a caller investigate with false context.
 *   - No free-form metadata: a Record<string, unknown> is a prompt-injection
 *     vector and could smuggle fields such as feedback_label.
 *   - transactionId is trimmed, 1–100 chars, and restricted to [A-Za-z0-9_-]
 *     because it is interpolated into the agent prompt and into logs.
 *     Revisit the pattern once docs/data-contract.md confirms the real ID format.
 *
 * ADR-005: all request validation uses Zod (see ZodValidationPipe).
 */
export const createInvestigationSchema = z
  .object({
    transactionId: z
      .string()
      .trim()
      .min(1, 'transactionId must not be blank')
      .max(100, 'transactionId must not exceed 100 characters')
      .regex(
        /^[A-Za-z0-9_-]+$/,
        'transactionId may only contain letters, digits, "_" and "-"',
      ),
  })
  .strict('Unknown fields are not allowed');

export type CreateInvestigationInput = z.infer<typeof createInvestigationSchema>;
