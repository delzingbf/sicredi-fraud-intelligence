import { Module } from '@nestjs/common';
import {
  AGENT_ORCHESTRATOR,
  type AgentResult,
  type IAgentOrchestrator,
} from './agent.orchestrator.interface.js';
import type { InvestigationRequest } from '@fraud-intelligence/contracts';

/**
 * AgentModule — provides AGENT_ORCHESTRATOR to any module that imports it.
 *
 * Current state: ships a mock implementation that returns INCONCLUSIVE.
 * This allows the full app to run and POST /investigations to respond correctly
 * while Dev C implements the real WatsonxClient + AgentOrchestrator.
 *
 * When Dev C delivers the real implementation:
 *   1. Add WatsonxClient and AgentOrchestrator as providers here.
 *   2. Change useValue → useClass: AgentOrchestrator.
 *   3. Remove the inline mock object below.
 *   No changes needed in InvestigationModule or AppModule.
 */
@Module({
  providers: [
    {
      provide: AGENT_ORCHESTRATOR,
      useValue: {
        investigate: (request: InvestigationRequest): Promise<AgentResult> => {
          const report = {
            schemaVersion: '1.0',
            transactionId: request.transactionId,
            riskLevel: 'INCONCLUSIVE',
            recommendedAction: 'MANUAL_REVIEW',
            toolsExecuted: [] as string[],
            evidenceFor: [],
            evidenceAgainst: [],
            missingInformation: ['AgentOrchestrator not yet implemented'],
            contradictions: [],
            explanation: 'Mock agent: real implementation pending (Dev C).',
            requiresHumanReview: true,
            confidence: 'LOW',
          };
          return Promise.resolve({
            finalText: JSON.stringify(report),
            toolsExecuted: [],
          });
        },
      } satisfies IAgentOrchestrator,
    },
  ],
  exports: [AGENT_ORCHESTRATOR],
})
export class AgentModule {}
