import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { DataModule } from '../data/data.module.js';
import { GetCustomerProfileTool } from './get-customer-profile.tool.js';
import { GetTransactionDetailsTool } from './get-transaction-details.tool.js';
import { AnalyzeTransactionVelocityTool } from './analyze-transaction-velocity.tool.js';
import { AnalyzeSpendingPatternTool } from './analyze-spending-pattern.tool.js';
import { AnalyzeTransactionContextTool } from './analyze-transaction-context.tool.js';
import { CheckMerchantHistoryTool } from './check-merchant-history.tool.js';
import { CheckCustomerRiskEventsTool } from './check-customer-risk-events.tool.js';
import { CheckGeographicConsistencyTool } from './check-geographic-consistency.tool.js';
import { GetRiskPolicyTool } from './get-risk-policy.tool.js';

/**
 * ToolsModule — groups all real tool providers.
 *
 * Each tool uses OnModuleInit to register itself in ToolRegistry, replacing
 * the mocks pre-registered in AgentModule. AgentModule is not modified.
 */
@Module({
  imports: [DataModule, AgentModule],
  providers: [
    GetTransactionDetailsTool,
    GetCustomerProfileTool,
    AnalyzeTransactionVelocityTool,
    AnalyzeSpendingPatternTool,
    AnalyzeTransactionContextTool,
    CheckMerchantHistoryTool,
    CheckCustomerRiskEventsTool,
    CheckGeographicConsistencyTool,
    GetRiskPolicyTool,
  ],
})
export class ToolsModule {}
