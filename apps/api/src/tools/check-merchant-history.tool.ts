import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult, MerchantHistory } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';
import { DataService } from '../data/data.service.js';

/**
 * CheckMerchantHistoryTool — returns aggregate statistics and risk scores
 * for a given merchant (acceptor_id).
 *
 * Risk scores (acceptorRisk, acceptorRiskyFlag, etc.) are snapshot values
 * from the target transaction row, not computed aggregates.
 */
@Injectable()
export class CheckMerchantHistoryTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('checkMerchantHistory', {
      definition: {
        type: 'function',
        function: {
          name: 'checkMerchantHistory',
          description:
            'Retorna o histórico agregado do estabelecimento: total de transações, ' +
            'valor médio/máximo/mínimo e scores de risco (acceptorRisk, acceptorRiskyFlag, ' +
            'acceptorMastercardRisk, acceptorVisaRisk). Scores de risco elevados ou flag ' +
            'numérico alto indicam estabelecimento conhecido por atividade suspeita. ' +
            'Requer merchantId e transactionId de getTransactionDetails.',
          parameters: {
            type: 'object',
            properties: {
              merchantId: {
                type: 'string',
                description: 'acceptor_id from getTransactionDetails',
              },
              transactionId: {
                type: 'string',
                description: 'event_external_id of the current transaction',
              },
            },
            required: ['merchantId', 'transactionId'],
          },
        },
      },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(
    args: Record<string, unknown>,
  ): Promise<ToolResult<MerchantHistory>> {
    const merchantId = args['merchantId'];
    const transactionId = args['transactionId'];

    if (typeof merchantId !== 'string' || !merchantId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'checkMerchantHistory', dataSource: 'postgresql', missingFields: ['merchantId'] },
        message: 'merchantId is required',
      };
    }
    if (typeof transactionId !== 'string' || !transactionId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'checkMerchantHistory', dataSource: 'postgresql', missingFields: ['transactionId'] },
        message: 'transactionId is required',
      };
    }

    let history: Awaited<ReturnType<DataService['getMerchantHistory']>>;
    try {
      history = await this.dataService.getMerchantHistory(merchantId, transactionId);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: { tool: 'checkMerchantHistory', dataSource: 'postgresql', missingFields: [] },
        message: 'Database unavailable',
      };
    }

    return {
      status: 'success',
      data: {
        merchantId,
        totalTransactions: history.totalTransactions,
        avgAmount: history.avgAmount,
        maxAmount: history.maxAmount,
        minAmount: history.minAmount,
        acceptorRisk: history.acceptorRisk,
        acceptorRiskyFlag: history.acceptorRiskyFlag,
        acceptorMastercardRisk: history.acceptorMastercardRisk,
        acceptorVisaRisk: history.acceptorVisaRisk,
      },
      metadata: {
        tool: 'checkMerchantHistory',
        dataSource: 'postgresql',
        missingFields: [],
      },
    };
  }
}
