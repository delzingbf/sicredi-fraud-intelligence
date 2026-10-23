import { z } from 'zod';

/** Body for POST /investigations/:id/member-verification/confirm */
export const confirmVerificationSchema = z
  .object({
    /** The associate's answer to the verification request */
    decision: z.enum(['CONFIRMED', 'DENIED']),
  })
  .strict('Unknown fields are not allowed');

export type ConfirmVerificationInput = z.infer<typeof confirmVerificationSchema>;
