import type {
  InvestigationResult,
  VerificationRecord,
  VerificationDecision,
} from '@fraud-intelligence/contracts';

/** Error thrown when the API returns a non-OK response. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = String(body.message);
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

/**
 * POST /investigations
 * Submits a transaction ID for fraud investigation.
 * Always resolves (failures return INCONCLUSIVE risk level).
 */
export async function startInvestigation(
  transactionId: string,
): Promise<InvestigationResult> {
  const res = await fetch('/investigations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId }),
  });
  return handleResponse<InvestigationResult>(res);
}

/**
 * POST /investigations/:id/member-verification
 * Opens a simulated member verification request.
 * Throws ApiError with status 403 if the policy denies it.
 */
export async function requestMemberVerification(
  investigationId: string,
): Promise<VerificationRecord> {
  const res = await fetch(`/investigations/${investigationId}/member-verification`, {
    method: 'POST',
  });
  return handleResponse<VerificationRecord>(res);
}

/**
 * POST /investigations/:id/member-verification/confirm
 * Records the associate's CONFIRMED or DENIED decision.
 */
export async function confirmMemberVerification(
  investigationId: string,
  decision: VerificationDecision,
): Promise<VerificationRecord> {
  const res = await fetch(
    `/investigations/${investigationId}/member-verification/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    },
  );
  return handleResponse<VerificationRecord>(res);
}

/**
 * GET /investigations/:id/member-verification
 * Returns the current verification record.
 */
export async function getMemberVerification(
  investigationId: string,
): Promise<VerificationRecord> {
  const res = await fetch(
    `/investigations/${investigationId}/member-verification`,
  );
  return handleResponse<VerificationRecord>(res);
}
