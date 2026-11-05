import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult, TransactionDetails } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';
import { DataService } from '../data/data.service.js';
import type { Transaction } from '../data/transaction.entity.js';

/**
 * GetTransactionDetailsTool — real implementation backed by PostgreSQL.
 *
 * Registers itself in ToolRegistry on module init, replacing the mock that
 * was pre-registered in AgentModule. No changes to agent.module.ts are needed.
 */
@Injectable()
export class GetTransactionDetailsTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('getTransactionDetails', {
      definition: {
        type: 'function',
        function: {
          name: 'getTransactionDetails',
          description:
            'Recupera os dados completos de uma transação a partir do seu ID: valor, ' +
            'horário, tipo (débito/crédito), canal, estabelecimento, MCC, customer_id do ' +
            'titular e flag de cartão presente. Deve ser a PRIMEIRA ferramenta chamada em ' +
            'qualquer investigação — todas as demais ferramentas dependem do customerId ' +
            'retornado aqui.',
          parameters: {
            type: 'object',
            properties: {
              transactionId: {
                type: 'string',
                description: 'ID único da transação (event_external_id).',
              },
            },
            required: ['transactionId'],
          },
        },
      },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(
    args: Record<string, unknown>,
  ): Promise<ToolResult<TransactionDetails>> {
    const transactionId = args['transactionId'];

    if (typeof transactionId !== 'string' || !transactionId) {
      return {
        status: 'error',
        data: null,
        metadata: {
          tool: 'getTransactionDetails',
          dataSource: 'postgresql',
          missingFields: ['transactionId'],
        },
        message: 'transactionId is required',
      };
    }

    let tx: Transaction | null;
    try {
      tx = await this.dataService.getTransactionById(transactionId);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: {
          tool: 'getTransactionDetails',
          dataSource: 'postgresql',
          missingFields: [],
        },
        message: 'Database unavailable',
      };
    }

    if (!tx) {
      return {
        status: 'not_found',
        data: null,
        metadata: {
          tool: 'getTransactionDetails',
          dataSource: 'postgresql',
          missingFields: [],
        },
        message: `Transaction ${transactionId} not found`,
      };
    }

    const missingFields: string[] = [];
    if (tx.amount == null) missingFields.push('amount');
    if (tx.tipoTransacao == null) missingFields.push('type');
    if (tx.modalidadeTransacao == null) missingFields.push('modality');
    if (tx.segmentChannelType == null) missingFields.push('channel');
    if (tx.cardPresenceFlag == null) missingFields.push('cardPresent');
    if (tx.acceptorId == null) missingFields.push('merchantId');
    if (tx.acceptorName == null) missingFields.push('merchantName');
    if (tx.mcc == null) missingFields.push('mcc');

    return {
      status: 'success',
      data: {
        transactionId: tx.id,
        customerId: tx.customerId,
        amount: tx.amount,
        timestamp: tx.eventOccurredAt.toISOString(),
        type: tx.tipoTransacao,
        modality: tx.modalidadeTransacao,
        channel: tx.segmentChannelType,
        cardPresent: tx.cardPresenceFlag,
        merchantId: tx.acceptorId,
        merchantName: tx.acceptorName,
        merchantCity: tx.acceptorCity,
        merchantRegion: tx.acceptorRegion,
        mcc: tx.mcc,
        cardId: tx.cardId,
      },
      metadata: {
        tool: 'getTransactionDetails',
        dataSource: 'postgresql',
        missingFields,
      },
    };
  }
}
