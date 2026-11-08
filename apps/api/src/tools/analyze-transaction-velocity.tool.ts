import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult, VelocityAnalysis } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';
import { DataService } from '../data/data.service.js';

/**
 * AnalyzeTransactionVelocityTool — analyzes card usage velocity signals.
 *
 * Reads pre-computed columns from the transaction row plus dynamic
 * counts/amounts over 1h and 24h windows.
 */
@Injectable()
export class AnalyzeTransactionVelocityTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('analyzeTransactionVelocity', {
      definition: {
        type: 'function',
        function: {
          name: 'analyzeTransactionVelocity',
          description:
            'Analisa a velocidade de uso do cartão: lê campos pré-calculados da transação ' +
            '(contagem no último minuto, distância e velocidade entre terminais na última hora) ' +
            'e computa dinamicamente a contagem e o valor total de transações nas últimas 1h e ' +
            '24h. Alta velocidade ou muitas transações em janelas curtas são indicadores fortes ' +
            'de fraude. Requer transactionId, cardId e timestamp de getTransactionDetails.',
          parameters: {
            type: 'object',
            properties: {
              transactionId: {
                type: 'string',
                description: 'event_external_id of the transaction to analyze',
              },
              cardId: {
                type: 'string',
                description: 'card_id from getTransactionDetails',
              },
              timestamp: {
                type: 'string',
                description: 'ISO-8601 timestamp from getTransactionDetails',
              },
            },
            required: ['transactionId', 'cardId', 'timestamp'],
          },
        },
      },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(
    args: Record<string, unknown>,
  ): Promise<ToolResult<VelocityAnalysis>> {
    const transactionId = args['transactionId'];
    const cardId = args['cardId'];
    const timestampArg = args['timestamp'];

    if (typeof transactionId !== 'string' || !transactionId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeTransactionVelocity', dataSource: 'postgresql', missingFields: ['transactionId'] },
        message: 'transactionId is required',
      };
    }
    if (typeof cardId !== 'string' || !cardId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeTransactionVelocity', dataSource: 'postgresql', missingFields: ['cardId'] },
        message: 'cardId is required',
      };
    }
    if (typeof timestampArg !== 'string' || !timestampArg) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeTransactionVelocity', dataSource: 'postgresql', missingFields: ['timestamp'] },
        message: 'timestamp is required',
      };
    }

    const ts = new Date(timestampArg);
    if (isNaN(ts.getTime())) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeTransactionVelocity', dataSource: 'postgresql', missingFields: ['timestamp'] },
        message: 'timestamp is not a valid ISO-8601 date',
      };
    }

    let velocity: Awaited<ReturnType<DataService['getCardVelocity']>>;
    try {
      velocity = await this.dataService.getCardVelocity(cardId, transactionId, ts);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: { tool: 'analyzeTransactionVelocity', dataSource: 'postgresql', missingFields: [] },
        message: 'Database unavailable',
      };
    }

    const parseVarchar = (v: string | null | undefined): number | null => {
      if (v == null) return null;
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    };

    const countLast1m = parseVarchar(velocity.precomputed?.cardidCount1m);
    const distPrevTerminal1h = parseVarchar(velocity.precomputed?.cpCardPrevTermDist1h);
    const velocityTerminal1h = parseVarchar(velocity.precomputed?.cpCardTermVel1h);

    const missingFields: string[] = [];
    if (countLast1m === null) missingFields.push('cardidCount1m');
    if (distPrevTerminal1h === null) missingFields.push('cpCardPrevTermDist1h');
    if (velocityTerminal1h === null) missingFields.push('cpCardTermVel1h');

    return {
      status: 'success',
      data: {
        countLast1m,
        distPrevTerminal1h,
        velocityTerminal1h,
        countLast1h: velocity.countLast1h,
        countLast24h: velocity.countLast24h,
        totalAmountLast1h: velocity.totalAmountLast1h,
      },
      metadata: { tool: 'analyzeTransactionVelocity', dataSource: 'postgresql', missingFields },
    };
  }
}
