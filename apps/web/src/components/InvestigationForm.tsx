import { type FormEvent, useState } from 'react';

interface Props {
  onSubmit: (transactionId: string) => void;
  loading: boolean;
}

/**
 * InvestigationForm — transaction ID input and submit button.
 *
 * Validates the ID locally before calling onSubmit:
 * 1–100 characters, letters / digits / underscores / hyphens only
 * (matches the API's createInvestigationSchema).
 */
export function InvestigationForm({ onSubmit, loading }: Props) {
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  function validate(id: string): string | null {
    if (!id.trim()) return 'Transaction ID is required.';
    if (id.length > 100) return 'Transaction ID must be at most 100 characters.';
    if (!/^[A-Za-z0-9_-]+$/.test(id))
      return 'Only letters, digits, underscores and hyphens are allowed.';
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validate(value.trim());
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    onSubmit(value.trim());
  }

  return (
    <form className="investigation-form" onSubmit={handleSubmit} noValidate>
      <div className="form-row">
        <label htmlFor="txn-id" className="form-label">
          Transaction ID
        </label>
        <div className="form-input-group">
          <input
            id="txn-id"
            type="text"
            className={`form-input${validationError ? ' form-input--error' : ''}`}
            placeholder="e.g. EVT_SYN_000000001"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (validationError) setValidationError(null);
            }}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={loading || !value.trim()}
          >
            {loading ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Investigating…
              </>
            ) : (
              'Investigate'
            )}
          </button>
        </div>
        {validationError && (
          <p className="form-error" role="alert">
            {validationError}
          </p>
        )}
      </div>
    </form>
  );
}
