import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { DataModule } from '../data/data.module.js';
import { GetCustomerProfileTool } from './get-customer-profile.tool.js';
import { GetTransactionDetailsTool } from './get-transaction-details.tool.js';

/**
 * ToolsModule — groups all real tool providers.
 *
 * Each tool uses OnModuleInit to register itself in ToolRegistry, replacing
 * the mocks pre-registered in AgentModule. AgentModule is not modified.
 *
 * Sub-Tasks 6 and 7 will add more tool providers here.
 */
@Module({
  imports: [DataModule, AgentModule],
  providers: [GetTransactionDetailsTool, GetCustomerProfileTool],
})
export class ToolsModule {}
