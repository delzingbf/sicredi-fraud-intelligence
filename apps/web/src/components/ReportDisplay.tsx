import type { InvestigationReport, RiskLevel, RecommendedAction } from '@fraud-intelligence/contracts';

/** Generates a plain-text report and triggers a browser download. */
function downloadReport(report: InvestigationReport, investigationId: string) {
  const lines: string[] = [];
  const divider = '='.repeat(60);
  const thin    = '-'.repeat(60);

  const section = (title: string, items: string[]) => {
    lines.push('');
    lines.push(title.toUpperCase());
    lines.push(thin);
    if (items.length === 0) {
      lines.push('  (none)');
    } else {
      items.forEach((item) => lines.push(`  • ${item}`));
    }
  };

  lines.push('FRAUDLENS — INVESTIGATION REPORT');
  lines.push(divider);
  lines.push(`Generated at    : ${new Date().toISOString()}`);
  lines.push(`Investigation ID: ${investigationId}`);
  lines.push(`Transaction ID  : ${report.transactionId}`);
  lines.push(`Schema version  : ${report.schemaVersion}`);
  lines.push(divider);
  lines.push('');
  lines.push('ASSESSMENT');
  lines.push(thin);
  lines.push(`Risk Level       : ${report.riskLevel}`);
  lines.push(`Recommended Action: ${report.recommendedAction}`);
  lines.push(`Confidence       : ${report.confidence}`);
  lines.push(`Requires Human Review: ${report.requiresHumanReview ? 'Yes' : 'No'}`);

  lines.push('');
  lines.push('EXPLANATION');
  lines.push(thin);
  // Wrap long explanation lines at ~80 chars
  const words = report.explanation.split(' ');
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > 78) {
      lines.push(line.trim());
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) lines.push(line.trim());

  section('Evidence For Risk', report.evidenceFor);
  section('Evidence Against Risk', report.evidenceAgainst);
  if (report.missingInformation.length > 0)
    section('Missing Information', report.missingInformation);
  if (report.contradictions.length > 0)
    section('Contradictions', report.contradictions);

  lines.push('');
  lines.push('TOOLS EXECUTED');
  lines.push(thin);
  report.toolsExecuted.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));

  lines.push('');
  lines.push(divider);
  lines.push('IBM AI Experiential Learning Lab 2026 — Sicredi track / Hello Moto');

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `fraudlens-${report.transactionId}-${investigationId.slice(0, 8)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

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
        {/* Download button — right edge of header, vertically centred */}
        <button
          type="button"
          className="btn btn--download"
          onClick={() => downloadReport(report, investigationId)}
          title="Download report as .txt"
          aria-label="Download report as .txt"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M9 2v10M5 8l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2.5 15.5h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
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

/** Standalone colour legend — render outside the report card. */
export function RiskLegend() {
  return (
    <div className="risk-legend-standalone" aria-label="Risk level colour guide">
      <span className="risk-legend-label">Colour guide:</span>
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
  );
}
