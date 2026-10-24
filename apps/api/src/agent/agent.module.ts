import { Module } from '@nestjs/common';
import { AGENT_ORCHESTRATOR } from './agent.orchestrator.interface.js';
import { AgentOrchestrator } from './agent.orchestrator.js';
import { WatsonxClient } from './watsonx.client.js';
import { ToolRegistry } from './tool.registry.js';
import type { ToolResult } from '@fraud-intelligence/contracts';

/**
 * AgentModule — provides the full investigation agent stack.
 *
 * Providers:
 *   WatsonxClient     — HTTP wrapper for IBM Chat API
 *   ToolRegistry      — tool catalog, whitelist, dispatch
 *   AgentOrchestrator — ReAct loop, registered as AGENT_ORCHESTRATOR
 *
 * Mock tools are pre-registered here so the end-to-end flow can be exercised
 * immediately (Sub-Task 4).  Real tool implementations (Sub-Tasks 3, 6, 7)
 * will replace or add to these registrations once DataService is available.
 *
 * To add a real tool:
 *   1. Implement the tool file in src/tools/.
 *   2. Inject ToolRegistry in that tool's provider / OnModuleInit.
 *   3. Call registry.register(name, { definition, implementation }).
 *   No changes to this file are needed.
 */
@Module({
  providers: [
    WatsonxClient,
    ToolRegistry,
    {
      provide: AGENT_ORCHESTRATOR,
      useClass: AgentOrchestrator,
    },
    // ── Mock tool registration ───────────────────────────────────────────────
    // These run at module init via a factory provider so ToolRegistry is
    // already instantiated when the registrations happen.
    {
      provide: 'MOCK_TOOL_REGISTRAR',
      useFactory: (registry: ToolRegistry) => {
        registry.register('getTransactionDetails', {
          definition: {
            type: 'function',
            function: {
              name: 'getTransactionDetails',
              description:
                'Recupera os dados completos de uma transação: valor, horário, canal, ' +
                'estabelecimento, customerId do titular e outros atributos disponíveis. ' +
                'Deve ser a primeira ferramenta chamada para qualquer investigação.',
              parameters: {
                type: 'object',
                properties: {
                  transactionId: {
                    type: 'string',
                    description: 'ID da transação a consultar.',
                  },
                },
                required: ['transactionId'],
              },
            },
          },
          implementation: (args): ToolResult => {
            const transactionId = args['transactionId'] as string | undefined;
            if (!transactionId) {
              return {
                status: 'error',
                data: null,
                metadata: { tool: 'getTransactionDetails', dataSource: 'mock', missingFields: ['transactionId'] },
                message: 'transactionId is required',
              };
            }
            // Mock data keyed by transactionId so tests can rely on known values.
            const mockData: Record<string, object> = {
              'TX-1001': {
                transactionId: 'TX-1001',
                customerId: 'CUST-42',
                amount: 4200.0,
                currency: 'BRL',
                merchant: 'Eletrônicos FastBuy',
                merchantCategory: 'electronics',
                channel: 'online',
                timestamp: '2025-01-15T03:22:00Z',
                cardLast4: '7891',
                deviceId: 'DEV-99',
              },
            };
            const data = mockData[transactionId];
            if (!data) {
              return {
                status: 'not_found',
                data: null,
                metadata: { tool: 'getTransactionDetails', dataSource: 'mock', missingFields: [] },
                message: `Transaction ${transactionId} not found in mock dataset`,
              };
            }
            return {
              status: 'success',
              data,
              metadata: { tool: 'getTransactionDetails', dataSource: 'mock', missingFields: [] },
            };
          },
        });

        registry.register('getCustomerProfile', {
          definition: {
            type: 'function',
            function: {
              name: 'getCustomerProfile',
              description:
                'Consulta o perfil histórico do associado: valor médio de compras, percentil 95, ' +
                'horários usuais e total de transações. Usar antes de qualquer análise de comportamento.',
              parameters: {
                type: 'object',
                properties: {
                  customerId: {
                    type: 'string',
                    description: 'Identificador único do associado.',
                  },
                },
                required: ['customerId'],
              },
            },
          },
          implementation: (args): ToolResult => {
            const customerId = args['customerId'] as string | undefined;
            if (!customerId) {
              return {
                status: 'error',
                data: null,
                metadata: { tool: 'getCustomerProfile', dataSource: 'mock', missingFields: ['customerId'] },
                message: 'customerId is required',
              };
            }
            return {
              status: 'success',
              data: {
                customerId,
                averageAmount: 180,
                p95Amount: 650,
                usualPurchaseHours: '08:00-22:00',
                historicalTransactions: 42,
              },
              metadata: { tool: 'getCustomerProfile', dataSource: 'mock', missingFields: [] },
            };
          },
        });

        registry.register('analyzeTransactionVelocity', {
          definition: {
            type: 'function',
            function: {
              name: 'analyzeTransactionVelocity',
              description:
                'Verifica se houve rajada de transações recentes: contagem e valor acumulado ' +
                'em janelas de tempo curtas. Útil para detectar uso massivo em pouco tempo.',
              parameters: {
                type: 'object',
                properties: {
                  transactionId: {
                    type: 'string',
                    description: 'ID da transação a investigar.',
                  },
                },
                required: ['transactionId'],
              },
            },
          },
          implementation: (args): ToolResult => {
            const transactionId = args['transactionId'] as string | undefined;
            if (!transactionId) {
              return {
                status: 'error',
                data: null,
                metadata: { tool: 'analyzeTransactionVelocity', dataSource: 'mock', missingFields: ['transactionId'] },
                message: 'transactionId is required',
              };
            }
            return {
              status: 'success',
              data: {
                transactionId,
                transactionsLast10Minutes: 3,
                totalAmountLast10Minutes: 10800,
                velocityAnomaly: true,
              },
              metadata: { tool: 'analyzeTransactionVelocity', dataSource: 'mock', missingFields: [] },
            };
          },
        });
      },
      inject: [ToolRegistry],
    },
  ],
  exports: [AGENT_ORCHESTRATOR, ToolRegistry],
})
export class AgentModule {}
