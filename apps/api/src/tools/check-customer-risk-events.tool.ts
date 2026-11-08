import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult, CustomerRiskEvents } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';
import { DataService } from '../data/data.service.js';

/**
 * CheckCustomerRiskEventsTool — returns the customer's risk signals:
 * categorical risk rating, malware flag, and decline counts in the last
 * 7 and 30 days.
 */
@Injectable()
export class CheckCustomerRiskEventsTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('checkCustomerRiskEvents', {
      definition: {
        type: 'function',
        function: {
          name: 'checkCustomerRiskEvents',
          description:
            'Retorna os sinais de risco do associado: classificação de risco (baixo/medio/alto), ' +
            'flag de malware detectado no dispositivo e contagem de transações recusadas nos ' +
            'últimos 7 e 30 dias. Alta contagem de recusas recentes indica cartão comprometido ' +
            'ou tentativas repetidas de fraude. Requer customerId e transactionId de getTransactionDetails.',
          parameters: {
            type: 'object',
            properties: {
              customerId: {
                type: 'string',
                description: 'customer_id from getTransactionDetails',
              },
              transactionId: {
                type: 'string',
                description: 'event_external_id of the current transaction',
              },
            },
            required: ['customerId', 'transactionId'],
          },
        },
      },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(
    args: Record<string, unknown>,
  ): Promise<ToolResult<CustomerRiskEvents>> {
    const customerId = args['customerId'];
    const transactionId = args['transactionId'];

    if (typeof customerId !== 'string' || !customerId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'checkCustomerRiskEvents', dataSource: 'postgresql', missingFields: ['customerId'] },
        message: 'customerId is required',
      };
    }
    if (typeof transactionId !== 'string' || !transactionId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'checkCustomerRiskEvents', dataSource: 'postgresql', missingFields: ['transactionId'] },
        message: 'transactionId is required',
      };
    }

    let events: Awaited<ReturnType<DataService['getCustomerRiskEvents']>>;
    try {
      events = await this.dataService.getCustomerRiskEvents(customerId, transactionId);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: { tool: 'checkCustomerRiskEvents', dataSource: 'postgresql', missingFields: [] },
        message: 'Database unavailable',
      };
    }

    return {
      status: 'success',
      data: {
        riskRating: events.riskRating,
        malwareFlag: events.malwareFlag,
        declinedLast30d: events.declinedLast30d,
        declinedLast7d: events.declinedLast7d,
      },
      metadata: {
        tool: 'checkCustomerRiskEvents',
        dataSource: 'postgresql',
        missingFields: [],
      },
    };
  }
}
