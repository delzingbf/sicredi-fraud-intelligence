import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult, TransactionContext } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';
import { DataService } from '../data/data.service.js';

/**
 * AnalyzeTransactionContextTool — analyzes temporal and channel context of a
 * transaction, detecting unknown channels and unusual transaction hours.
 */
@Injectable()
export class AnalyzeTransactionContextTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('analyzeTransactionContext', {
      definition: {
        type: 'function',
        function: {
          name: 'analyzeTransactionContext',
          description:
            'Analisa o contexto temporal e de canal da transação: hora do dia, dia da semana, ' +
            'canal (POS/e-commerce/ATM), tipo e presença de cartão. Compara com o histórico do ' +
            'associado para detectar canais nunca usados antes (isUnknownChannel) e horários ' +
            'atípicos (isUnusualHour ±2h). Novo associado sem histórico retorna distribuições ' +
            'vazias — isso por si só é contexto relevante.',
          parameters: {
            type: 'object',
            properties: {
              transactionId: {
                type: 'string',
                description: 'event_external_id',
              },
              customerId: {
                type: 'string',
                description: 'customer_id from getTransactionDetails',
              },
              timestamp: {
                type: 'string',
                description: 'ISO-8601 timestamp from getTransactionDetails',
              },
              channel: {
                type: 'string',
                description: 'segment_channel_type from getTransactionDetails',
              },
              transactionType: {
                type: 'string',
                description: 'type from getTransactionDetails',
              },
              modality: {
                type: 'string',
                description: 'modality from getTransactionDetails',
              },
              cardPresent: {
                type: 'boolean',
                description: 'cardPresent from getTransactionDetails',
              },
            },
            required: ['transactionId', 'customerId', 'timestamp'],
          },
        },
      },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(
    args: Record<string, unknown>,
  ): Promise<ToolResult<TransactionContext>> {
    const transactionId = args['transactionId'];
    const customerId = args['customerId'];
    const timestampArg = args['timestamp'];

    if (typeof transactionId !== 'string' || !transactionId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeTransactionContext', dataSource: 'postgresql', missingFields: ['transactionId'] },
        message: 'transactionId is required',
      };
    }
    if (typeof customerId !== 'string' || !customerId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeTransactionContext', dataSource: 'postgresql', missingFields: ['customerId'] },
        message: 'customerId is required',
      };
    }
    if (typeof timestampArg !== 'string' || !timestampArg) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeTransactionContext', dataSource: 'postgresql', missingFields: ['timestamp'] },
        message: 'timestamp is required',
      };
    }

    const ts = new Date(timestampArg);
    if (isNaN(ts.getTime())) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'analyzeTransactionContext', dataSource: 'postgresql', missingFields: ['timestamp'] },
        message: 'timestamp is not a valid ISO-8601 date',
      };
    }

    const channel = typeof args['channel'] === 'string' ? args['channel'] : null;
    const transactionType = typeof args['transactionType'] === 'string' ? args['transactionType'] : null;
    const modality = typeof args['modality'] === 'string' ? args['modality'] : null;
    const cardPresent = typeof args['cardPresent'] === 'boolean' ? args['cardPresent'] : null;

    const hourOfDay = ts.getUTCHours();
    const dayOfWeek = ts.getUTCDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let contextStats: Awaited<ReturnType<DataService['getCustomerContextStats']>>;
    try {
      contextStats = await this.dataService.getCustomerContextStats(customerId, transactionId);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: { tool: 'analyzeTransactionContext', dataSource: 'postgresql', missingFields: [] },
        message: 'Database unavailable',
      };
    }

    const { channelDistribution, hourDistribution, totalCount } = contextStats;

    // isUnknownChannel: true if channel is non-null, history exists, and channel was never seen
    const isUnknownChannel =
      channel !== null &&
      totalCount > 0 &&
      (channelDistribution[channel] === undefined || channelDistribution[channel] === 0);

    // isUnusualHour: true if none of the ±2h hour bins have history and history exists
    let isUnusualHour = false;
    if (totalCount > 0) {
      const hasNearbyHour = [-2, -1, 0, 1, 2].some((offset) => {
        const h = ((hourOfDay + offset) % 24 + 24) % 24;
        return (hourDistribution[String(h)] ?? 0) > 0;
      });
      isUnusualHour = !hasNearbyHour;
    }

    return {
      status: 'success',
      data: {
        hourOfDay,
        dayOfWeek,
        isWeekend,
        channel,
        transactionType,
        modality,
        cardPresent,
        historicalChannelDistribution: channelDistribution,
        historicalHourDistribution: hourDistribution,
        historicalTransactionCount: totalCount,
        isUnknownChannel,
        isUnusualHour,
      },
      metadata: { tool: 'analyzeTransactionContext', dataSource: 'postgresql', missingFields: [] },
    };
  }
}
