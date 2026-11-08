import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';

/**
 * CheckGeographicConsistencyTool — STUB.
 *
 * Geographic data fill rate is ~23.9% in the dataset (threshold: 30%).
 * Decision documented in docs/data-contract.md section 2.2 and AGENTS.md.
 *
 * The tool is registered so the agent is aware of its existence, but always
 * returns status:'unavailable'. The agent should list it in missingInformation.
 */
@Injectable()
export class CheckGeographicConsistencyTool implements OnModuleInit {
  constructor(private readonly registry: ToolRegistry) {}

  onModuleInit() {
    this.registry.register('checkGeographicConsistency', {
      definition: {
        type: 'function',
        function: {
          name: 'checkGeographicConsistency',
          description:
            'Verifica consistência geográfica entre o endereço do estabelecimento, ' +
            'o terminal e o IP do dispositivo. ATENÇÃO: dados geográficos têm preenchimento ' +
            '~24% no dataset — esta ferramenta retorna unavailable na maioria dos casos.',
          parameters: {
            type: 'object',
            properties: {
              transactionId: {
                type: 'string',
                description: 'event_external_id of the transaction',
              },
            },
            required: ['transactionId'],
          },
        },
      },
      implementation: (_args) => this.execute(),
    });
  }

  private execute(): ToolResult {
    return {
      status: 'unavailable',
      data: null,
      metadata: {
        tool: 'checkGeographicConsistency',
        dataSource: 'stub',
        missingFields: ['acceptor_latitude', 'terminal_latitude'],
      },
      message: 'Geographic data insufficient (fill rate ~24%, threshold 30%)',
    };
  }
}
