import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult, SpendingPattern } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';
import { DataService } from '../data/data.service.js';

/**
 * AnalyzeSpendingPatternTool — compares the current transaction amount to the
 * customer's historical spending pattern (avg, stddev, p95, z-score).
 */
@Injectable()
export class AnalyzeSpendingPatternTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('analyzeSpendingPattern', {
      definition: {
        type: 'function',
        function: {
          name: 'analyzeSpendingPattern',
          description:
            'Compara o valor da transação atual com o padrão histórico de gastos do associado: ' +
            'média, desvio padrão e percentil 95 calculados sobre transações anteriores. ' +
            'O campo zScore indica quantos desvios padrão o valor atual está acima da média — ' +
            'valores acima de 2.0 são atípicos. Requer transactionId, customerId, currentAmount ' +
            'e timestamp de getTransactionDetails.',
          parameters: {
            type: 'object',
            properties: {
              transactionId: {
                type: 'string',
                description: 'event_external_id of the transaction',
              },
              customerId: {
                type: 'string',
                description: 'customer_id from getTransactionDetails',
              },
              currentAmount: {
                type: 'number',
                description: 'amount from getTransactionDetails',
              },
              timestamp: {
                type: 'string',
                description: 'ISO-8601 timestamp from getTransactionDetails',
              },
            },
            required: ['transactionId', 'customerId', 'currentAmount', 'timestamp'],
          },
        },
      },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(
    args: Record<string, unknown>,
  ): Promise<ToolResult<SpendingPattern>> {
    const transactionId = args['transactionId'];
    const customerId = args['customerId'];
    const currentAmount = args['currentAmount'];
    const timestampArg = args['timestamp'];

    if (typeof transactionId !== 'string' || !transactionId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeSpendingPattern', dataSource: 'postgresql', missingFields: ['transactionId'] },
        message: 'transactionId is required',
      };
    }
    if (typeof customerId !== 'string' || !customerId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeSpendingPattern', dataSource: 'postgresql', missingFields: ['customerId'] },
        message: 'customerId is required',
      };
    }
    if (typeof currentAmount !== 'number') {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeSpendingPattern', dataSource: 'postgresql', missingFields: ['currentAmount'] },
        message: 'currentAmount is required and must be a number',
      };
    }
    if (typeof timestampArg !== 'string' || !timestampArg) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeSpendingPattern', dataSource: 'postgresql', missingFields: ['timestamp'] },
        message: 'timestamp is required',
      };
    }

    const ts = new Date(timestampArg);
    if (isNaN(ts.getTime())) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeSpendingPattern', dataSource: 'postgresql', missingFields: ['timestamp'] },
        message: 'timestamp is not a valid ISO-8601 date',
      };
    }

    let stats: Awaited<ReturnType<DataService['getCustomerSpendingStats']>>;
    try {
      stats = await this.dataService.getCustomerSpendingStats(customerId, transactionId, ts);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: { tool: 'analyzeSpendingPattern', dataSource: 'postgresql', missingFields: [] },
        message: 'Database unavailable',
      };
    }

    if (stats.transactionCount === 0) {
      return {
        status: 'unavailable',
        data: null,
        metadata: { tool: 'analyzeSpendingPattern', dataSource: 'postgresql', missingFields: [] },
        message: 'No historical transactions found for this customer',
      };
    }

    let zScore: number | null = null;
    if (stats.stddevAmount != null && stats.stddevAmount !== 0 && stats.avgAmount != null) {
      zScore = Math.round(((currentAmount - stats.avgAmount) / stats.stddevAmount) * 100) / 100;
    }

    return {
      status: 'success',
      data: {
        avgAmount: stats.avgAmount,
        stddevAmount: stats.stddevAmount,
        p95Amount: stats.p95Amount,
        historicalTransactionCount: stats.transactionCount,
        lastTransactionAt: stats.lastTransactionAt?.toISOString() ?? null,
        currentAmount,
        zScore,
      },
      metadata: { tool: 'analyzeSpendingPattern', dataSource: 'postgresql', missingFields: [] },
    };
  }
}
