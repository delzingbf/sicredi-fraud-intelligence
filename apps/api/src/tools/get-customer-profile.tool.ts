import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { CustomerProfile, ToolResult } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';
import { DataService } from '../data/data.service.js';
import type { Transaction } from '../data/transaction.entity.js';

/**
 * GetCustomerProfileTool — returns the most recent customer snapshot from
 * the transactions table (no separate customers table — see data-contract.md §2.3).
 *
 * Registers itself in ToolRegistry on module init, replacing the mock that
 * was pre-registered in AgentModule. No changes to agent.module.ts are needed.
 */
@Injectable()
export class GetCustomerProfileTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('getCustomerProfile', {
      definition: {
        type: 'function',
        function: {
          name: 'getCustomerProfile',
          description:
            'Retorna o perfil cadastral mais recente do associado: segmento, rating de risco, ' +
            'limite de crédito, saldo, renda presumida, score de onboarding, KYC e flags de ' +
            'alteração de e-mail/telefone. Usar logo após getTransactionDetails para estabelecer ' +
            'o perfil de risco base do titular antes de analisar padrões comportamentais.',
          parameters: {
            type: 'object',
            properties: {
              customerId: {
                type: 'string',
                description: 'customer_id retornado por getTransactionDetails.',
              },
            },
            required: ['customerId'],
          },
        },
      },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(
    args: Record<string, unknown>,
  ): Promise<ToolResult<CustomerProfile>> {
    const customerId = args['customerId'];

    if (typeof customerId !== 'string' || !customerId) {
      return {
        status: 'error',
        data: null,
        metadata: {
          tool: 'getCustomerProfile',
          dataSource: 'postgresql',
          missingFields: ['customerId'],
        },
        message: 'customerId is required',
      };
    }

    let snapshot: Transaction | null;
    try {
      snapshot = await this.dataService.getLatestCustomerSnapshot(customerId);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: {
          tool: 'getCustomerProfile',
          dataSource: 'postgresql',
          missingFields: [],
        },
        message: 'Database unavailable',
      };
    }

    if (!snapshot) {
      return {
        status: 'not_found',
        data: null,
        metadata: {
          tool: 'getCustomerProfile',
          dataSource: 'postgresql',
          missingFields: [],
        },
        message: `Customer ${customerId} not found`,
      };
    }

    const missingFields: string[] = [];
    if (snapshot.customerName == null) missingFields.push('name');
    if (snapshot.customerSegment == null) missingFields.push('segment');
    if (snapshot.customerRiskRating == null) missingFields.push('riskRating');
    if (snapshot.customerTotalCreditLimit == null) missingFields.push('totalCreditLimit');
    if (snapshot.customerPresumedIncome == null) missingFields.push('presumedIncome');
    if (snapshot.customerKycLvl == null) missingFields.push('kycLevel');

    return {
      status: 'success',
      data: {
        customerId: snapshot.customerId,
        name: snapshot.customerName,
        segment: snapshot.customerSegment,
        riskRating: snapshot.customerRiskRating,
        city: snapshot.customerCity,
        region: snapshot.customerRegion,
        registrationDate: snapshot.customerRegistrationDate,
        totalCreditLimit: snapshot.customerTotalCreditLimit,
        totalBalance: snapshot.customerTotalBalance,
        presumedIncome: snapshot.customerPresumedIncome,
        onboardingScore: snapshot.customerOnboardingScore,
        kycLevel: snapshot.customerKycLvl,
        numberOfCards: snapshot.customerNumberOfCards,
        emailChangeFlag: snapshot.customerEmailChangeFlag,
        phoneChangeFlag: snapshot.customerPhoneChangeFlag,
      },
      metadata: {
        tool: 'getCustomerProfile',
        dataSource: 'postgresql',
        missingFields,
      },
    };
  }
}
