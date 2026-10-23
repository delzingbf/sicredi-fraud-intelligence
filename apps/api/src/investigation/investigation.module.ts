import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvestigationController } from './investigation.controller.js';
import {
  INVESTIGATION_TIMEOUT_MS,
  InvestigationService,
} from './investigation.service.js';
import { InvestigationStore } from './investigation.store.js';
import { VerificationService } from './verification.service.js';
import { PolicyModule } from '../policy/policy.module.js';
import { AgentModule } from '../agent/agent.module.js';
import type { AppEnv } from '../config/app.config.js';

/**
 * InvestigationModule
 *
 * Wires together:
 *   - InvestigationController (HTTP layer — investigations + verification endpoints)
 *   - InvestigationService (investigation use case)
 *   - InvestigationStore (server-side record of reports, keyed by investigationId)
 *   - VerificationService (simulated member verification state machine)
 *   - PolicyModule (Zod validation + member-verification gate)
 *   - AgentModule (provides AGENT_ORCHESTRATOR — mock today, real when Dev C delivers)
 *
 * When Dev C replaces the mock with a real AgentOrchestrator, only AgentModule
 * needs to change.
 */
@Module({
  imports: [PolicyModule, AgentModule],
  controllers: [InvestigationController],
  providers: [
    InvestigationService,
    InvestigationStore,
    VerificationService,
    {
      provide: INVESTIGATION_TIMEOUT_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>) =>
        config.get('INVESTIGATION_TIMEOUT_MS', { infer: true }),
    },
  ],
})
export class InvestigationModule {}
