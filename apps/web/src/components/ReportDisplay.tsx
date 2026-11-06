import type { InvestigationReport, RiskLevel, RecommendedAction } from '@fraud-intelligence/contracts';

interface Props {
  report: InvestigationReport;
  investigationId: string;
  onRequestVerification: () => void;
  verificationRequested: boolean;
}

const RISK_LABELS: Record<RiskLevel, string> = {
  LOW_RISK: 'Low Risk',
  SUSPICIOUS: 'Suspicious',
  HIGH_RISK: 'High Risk',
  INCONCLUSIVE: 'Inconclusive',
};

const RISK_DESCRIPTIONS: Record<RiskLevel, string> = {
  LOW_RISK: 'No significant fraud signals detected',
  SUSPICIOUS: 'Unusual patterns warrant closer review',
  HIGH_RISK: 'Strong indicators of fraudulent activity',
  INCONCLUSIVE: 'Insufficient data to reach a conclusion',
};

const ACTION_LABELS: Record<RecommendedAction, string> = {
  PROCEED: 'Proceed',
  REQUEST_MEMBER_VERIFICATION: 'Request Member Verification',
  MANUAL_REVIEW: 'Manual Review Required',
};

const ACTION_DESCRIPTIONS: Record<RecommendedAction, string> = {
  PROCEED: 'Transaction appears legitimate — no intervention needed',
  REQUEST_MEMBER_VERIFICATION: 'Contact the member to confirm this transaction before proceeding',
  MANUAL_REVIEW: 'Escalate to a fraud analyst for manual assessment',
};

/** Small SVG icons — pure inline, no external deps */
function RiskIcon({ level }: { level: RiskLevel }) {
  switch (level) {
    case 'LOW_RISK':
      return (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M4 6.5l1.8 1.8L9 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'SUSPICIOUS':
      return (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M6.5 1.5L12 11.5H1L6.5 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M6.5 5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="6.5" cy="9.5" r="0.6" fill="currentColor" />
        </svg>
      );
    case 'HIGH_RISK':
      return (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M4.5 4.5l4 4M8.5 4.5l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'INCONCLUSIVE':
      return (
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 5.2c0-1 1.5-1.5 2-.8s0 1.4-.8 1.8V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="6.5" cy="9" r="0.6" fill="currentColor" />
        </svg>
      );
  }
}

function ActionIcon({ action }: { action: RecommendedAction }) {
  switch (action) {
    case 'PROCEED':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 7l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'REQUEST_MEMBER_VERIFICATION':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2.5 12c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'MANUAL_REVIEW':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M7 1.5L12.5 11.5H1.5L7 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="7" cy="10" r="0.6" fill="currentColor" />
        </svg>
      );
  }
}

/**
 * ReportDisplay — renders the full InvestigationReport returned by the agent.
 */
export function ReportDisplay({
  report,
  investigationId,
  onRequestVerification,
  verificationRequested,
}: Props) {
  const riskClass = report.riskLevel.toLowerCase().replace('_', '-');

  return (
    <div className={`report report--${riskClass}`}>
      {/* Header */}
      <div className="report-header">
        <div className="report-header-left">
          <span className={`risk-badge risk-badge--${riskClass}`}>
            <RiskIcon level={report.riskLevel} />
            {RISK_LABELS[report.riskLevel]}
          </span>
          <span className={`confidence-badge confidence-badge--${report.confidence.toLowerCase()}`}>
            {report.confidence} confidence
          </span>
        </div>
        <div className="report-meta">
          <span className="report-meta-item">
            <span className="report-meta-label">Transaction</span>
            <code>{report.transactionId}</code>
          </span>
          <span className="report-meta-item">
            <span className="report-meta-label">Investigation ID</span>
            <code>{investigationId}</code>
          </span>
        </div>
      </div>

      {/* Colour legend */}
      <div className="risk-legend" aria-label="Risk level colour guide">
        <span className="risk-legend-item risk-legend-item--low-risk">
          <RiskIcon level="LOW_RISK" /> Low Risk — no significant signals
        </span>
        <span className="risk-legend-item risk-legend-item--suspicious">
          <RiskIcon level="SUSPICIOUS" /> Suspicious — unusual patterns
        </span>
        <span className="risk-legend-item risk-legend-item--high-risk">
          <RiskIcon level="HIGH_RISK" /> High Risk — strong fraud indicators
        </span>
        <span className="risk-legend-item risk-legend-item--inconclusive">
          <RiskIcon level="INCONCLUSIVE" /> Inconclusive — insufficient data
        </span>
      </div>

      {/* Risk description */}
      <div className={`risk-description risk-description--${riskClass}`}>
        <strong>{RISK_LABELS[report.riskLevel]}:</strong>{' '}
        {RISK_DESCRIPTIONS[report.riskLevel]}
      </div>

      {/* Recommended action */}
      <div className={`action-banner action-banner--${report.recommendedAction.toLowerCase().replace(/_/g, '-')}`}>
        <ActionIcon action={report.recommendedAction} />
        <span>
          <strong>Recommended Action:</strong>{' '}
          {ACTION_LABELS[report.recommendedAction]}
          <span className="action-description"> — {ACTION_DESCRIPTIONS[report.recommendedAction]}</span>
        </span>
        {report.requiresHumanReview && (
          <span className="human-review-flag"> · Human review required</span>
        )}
      </div>

      {/* Explanation */}
      <section className="report-section">
        <h3 className="report-section-title">Agent Explanation</h3>
        <p className="report-explanation">{report.explanation}</p>
      </section>

      {/* Evidence */}
      <div className="report-evidence-grid">
        <EvidenceList
          title="Evidence For Risk"
          items={report.evidenceFor}
          variant="for"
        />
        <EvidenceList
          title="Evidence Against Risk"
          items={report.evidenceAgainst}
          variant="against"
        />
      </div>

      {/* Missing information + contradictions */}
      {(report.missingInformation.length > 0 || report.contradictions.length > 0) && (
        <div className="report-evidence-grid">
          {report.missingInformation.length > 0 && (
            <EvidenceList
              title="Missing Information"
              items={report.missingInformation}
              variant="missing"
            />
          )}
          {report.contradictions.length > 0 && (
            <EvidenceList
              title="Contradictions"
              items={report.contradictions}
              variant="contradiction"
            />
          )}
        </div>
      )}

      {/* Member verification CTA */}
      {report.recommendedAction === 'REQUEST_MEMBER_VERIFICATION' && (
        <div className="verification-cta">
          <p>
            The agent recommends contacting the member to confirm this transaction.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onRequestVerification}
            disabled={verificationRequested}
          >
            {verificationRequested
              ? 'Verification Requested'
              : 'Request Member Verification'}
          </button>
        </div>
      )}
    </div>
  );
}

function EvidenceList({
  title,
  items,
  variant,
}: {
  title: string;
  items: string[];
  variant: 'for' | 'against' | 'missing' | 'contradiction';
}) {
  return (
    <section className="report-section">
      <h3 className="report-section-title">{title}</h3>
      {items.length === 0 ? (
        <p className="report-empty">None reported.</p>
      ) : (
        <ul className={`evidence-list evidence-list--${variant}`}>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
