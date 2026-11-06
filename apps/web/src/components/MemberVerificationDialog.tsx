import { useState } from 'react';
import type { VerificationRecord, VerificationDecision } from '@fraud-intelligence/contracts';
import { confirmMemberVerification } from '../api.js';
import { ApiError } from '../api.js';

interface Props {
  investigationId: string;
  record: VerificationRecord;
  onResolved: (record: VerificationRecord) => void;
}

/**
 * MemberVerificationDialog — shown after a verification request has been opened.
 *
 * Displays the current status and — while PENDING — presents CONFIRMED / DENIED
 * buttons that call the confirm endpoint. This is a simulated flow: the "member"
 * decision is made by the operator in the UI.
 */
export function MemberVerificationDialog({
  investigationId,
  record,
  onResolved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: VerificationDecision) {
    setLoading(true);
    setError(null);
    try {
      const updated = await confirmMemberVerification(investigationId, decision);
      onResolved(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unexpected error. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="verification-dialog">
      <div className="verification-dialog-header">
        <h3>Member Verification</h3>
        <span className={`verification-status verification-status--${record.status.toLowerCase()}`}>
          {record.status}
        </span>
      </div>

      <dl className="verification-details">
        <dt>Transaction</dt>
        <dd><code>{record.transactionId}</code></dd>
        <dt>Requested at</dt>
        <dd>{new Date(record.requestedAt).toLocaleString()}</dd>
        {record.resolvedAt && (
          <>
            <dt>Resolved at</dt>
            <dd>{new Date(record.resolvedAt).toLocaleString()}</dd>
          </>
        )}
      </dl>

      {record.status === 'PENDING' && (
        <>
          <p className="verification-prompt">
            Simulate the member's response to this transaction confirmation request:
          </p>
          <div className="verification-actions">
            <button
              type="button"
              className="btn btn--success"
              onClick={() => decide('CONFIRMED')}
              disabled={loading}
            >
              Member Confirmed
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => decide('DENIED')}
              disabled={loading}
            >
              Member Denied
            </button>
          </div>
          {error && <p className="form-error">{error}</p>}
        </>
      )}

      {record.status !== 'PENDING' && (
        <p className={`verification-outcome verification-outcome--${record.status.toLowerCase()}`}>
          {record.status === 'CONFIRMED'
            ? 'The member confirmed this transaction.'
            : 'The member denied this transaction. Escalate for manual review.'}
        </p>
      )}
    </div>
  );
}
