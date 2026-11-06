import { useState } from 'react';
import type { InvestigationResult, VerificationRecord } from '@fraud-intelligence/contracts';
import { startInvestigation, requestMemberVerification } from './api.js';
import { ApiError } from './api.js';
import { InvestigationForm } from './components/InvestigationForm.js';
import { ReportDisplay, RiskLegend } from './components/ReportDisplay.js';
import { ToolTrace } from './components/ToolTrace.js';
import { MemberVerificationDialog } from './components/MemberVerificationDialog.js';
import './App.css';

type AppState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'result'; result: InvestigationResult }
  | { phase: 'error'; message: string };

export default function App() {
  const [state, setState] = useState<AppState>({ phase: 'idle' });

  // Verification state — independent of investigation state
  const [verification, setVerification] = useState<VerificationRecord | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationLoading, setVerificationLoading] = useState(false);

  async function handleInvestigate(transactionId: string) {
    setState({ phase: 'loading' });
    setVerification(null);
    setVerificationError(null);
    try {
      const result = await startInvestigation(transactionId);
      setState({ phase: 'result', result });
    } catch (err) {
      if (err instanceof ApiError) {
        setState({ phase: 'error', message: err.message });
      } else {
        setState({ phase: 'error', message: 'Unexpected error. Please try again.' });
      }
    }
  }

  async function handleRequestVerification() {
    if (state.phase !== 'result') return;
    setVerificationLoading(true);
    setVerificationError(null);
    try {
      const record = await requestMemberVerification(state.result.investigationId);
      setVerification(record);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setVerificationError(
          'Policy denied: this investigation does not qualify for member verification.',
        );
      } else if (err instanceof ApiError && err.status === 409) {
        setVerificationError('Member verification has already been requested.');
      } else if (err instanceof ApiError) {
        setVerificationError(err.message);
      } else {
        setVerificationError('Unexpected error. Please try again.');
      }
    } finally {
      setVerificationLoading(false);
    }
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-header-inner">
          <span className="app-logo">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 5v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <span className="app-title">FraudLens</span>
          <span className="app-subtitle">Sicredi Fraud Intelligence · Hello Moto</span>
        </div>
      </header>

      <main className="app-main">
        {/* Search panel */}
        <section className="search-panel">
          <InvestigationForm
            onSubmit={handleInvestigate}
            loading={state.phase === 'loading'}
          />
        </section>

        {/* Loading skeleton */}
        {state.phase === 'loading' && (
          <div className="loading-state" role="status" aria-live="polite">
            <span className="spinner spinner--large" aria-hidden="true" />
            <p>Investigating transaction with IBM Granite…</p>
            <p className="loading-hint">This may take up to 30 seconds.</p>
          </div>
        )}

        {/* Error state */}
        {state.phase === 'error' && (
          <div className="error-state" role="alert">
            <p className="error-title">Investigation failed</p>
            <p className="error-message">{state.message}</p>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setState({ phase: 'idle' })}
            >
              Try again
            </button>
          </div>
        )}

        {/* Result */}
        {state.phase === 'result' && (
          <>
          <RiskLegend />
          <div className="result-layout">
            {/* Main report */}
            <div className="result-main">
              <ReportDisplay
                report={state.result.report}
                investigationId={state.result.investigationId}
                onRequestVerification={handleRequestVerification}
                verificationRequested={verification !== null || verificationLoading}
              />
              {verificationError && (
                <p className="form-error verification-error" role="alert">
                  {verificationError}
                </p>
              )}
            </div>

            {/* Sidebar: tool trace + verification dialog */}
            <aside className="result-sidebar">
              <ToolTrace tools={state.result.report.toolsExecuted} />

              {verification && (
                <MemberVerificationDialog
                  investigationId={state.result.investigationId}
                  record={verification}
                  onResolved={setVerification}
                />
              )}
            </aside>
          </div>
          </>
        )}
      </main>

      <footer className="app-footer">
        IBM AI Experiential Learning Lab 2026 — Sicredi track
      </footer>
    </div>
  );
}
