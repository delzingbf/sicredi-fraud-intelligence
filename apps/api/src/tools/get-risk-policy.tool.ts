import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';

/**
 * Static risk policy returned by the `getRiskPolicy` tool.
 * Contains thresholds and rules used to guide the agent's final assessment.
 */
interface RiskPolicy {
  highRiskAmountThreshold: number;
  suspiciousVelocityCount1h: number;
  suspiciousVelocityCount24h: number;
  highRiskDeclinedLast7d: number;
  highRiskDeclinedLast30d: number;
  highRiskAcceptorRiskThreshold: number;
  riskLevels: {
    LOW_RISK: string;
    SUSPICIOUS: string;
    HIGH_RISK: string;
    INCONCLUSIVE: string;
  };
  recommendedActions: {
    PROCEED: string;
    REQUEST_MEMBER_VERIFICATION: string;
    MANUAL_REVIEW: string;
  };
}

const RISK_POLICY: RiskPolicy = {
  /** Transactions above this amount (BRL) are flagged for additional scrutiny */
  highRiskAmountThreshold: 5000,
  /** More than this many card uses in a 1-hour window suggests velocity fraud */
  suspiciousVelocityCount1h: 5,
  /** More than this many card uses in a 24-hour window suggests card compromise */
  suspiciousVelocityCount24h: 15,
  /** More than this many declines in the last 7 days indicates active attack */
  highRiskDeclinedLast7d: 3,
  /** More than this many declines in the last 30 days indicates compromised card */
  highRiskDeclinedLast30d: 5,
  /** acceptorRisk above this value indicates a risky merchant */
  highRiskAcceptorRiskThreshold: 0.7,
  riskLevels: {
    LOW_RISK: 'Transaction shows no significant fraud indicators',
    SUSPICIOUS: 'One or more mild anomalies detected — monitor closely',
    HIGH_RISK: 'Multiple strong fraud signals — immediate action required',
    INCONCLUSIVE: 'Insufficient data to make a reliable risk assessment',
  },
  recommendedActions: {
    PROCEED: 'Approve transaction — risk within acceptable bounds',
    REQUEST_MEMBER_VERIFICATION: 'Contact associate to confirm transaction legitimacy',
    MANUAL_REVIEW: 'Escalate to fraud analyst for manual investigation',
  },
};

/**
 * GetRiskPolicyTool — returns the static fraud risk policy configuration.
 *
 * No database access required. Provides thresholds and decision guidance
 * the agent uses to calibrate its final risk assessment.
 */
@Injectable()
export class GetRiskPolicyTool implements OnModuleInit {
  constructor(private readonly registry: ToolRegistry) {}

  onModuleInit() {
    this.registry.register('getRiskPolicy', {
      definition: {
        type: 'function',
        function: {
          name: 'getRiskPolicy',
          description:
            'Retorna a política de risco estática: limites de valor, limiares de velocidade, ' +
            'contagem de recusas e scores de risco de estabelecimento que definem os critérios ' +
            'de classificação LOW_RISK / SUSPICIOUS / HIGH_RISK. Use para calibrar a avaliação final.',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      implementation: () => this.execute(),
    });
  }

  private execute(): ToolResult<RiskPolicy> {
    return {
      status: 'success',
      data: RISK_POLICY,
      metadata: {
        tool: 'getRiskPolicy',
        dataSource: 'static',
        missingFields: [],
      },
    };
  }
}
