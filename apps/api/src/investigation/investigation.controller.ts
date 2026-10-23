import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type {
  InvestigationResult,
  VerificationRecord,
} from '@fraud-intelligence/contracts';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe.js';
import {
  createInvestigationSchema,
  type CreateInvestigationInput,
} from './dto/create-investigation.schema.js';
import {
  confirmVerificationSchema,
  type ConfirmVerificationInput,
} from './dto/verification.schema.js';
import { InvestigationService } from './investigation.service.js';
import { VerificationService } from './verification.service.js';

const investigationIdPipe = new ParseUUIDPipe({ version: '4' });

/**
 * InvestigationController — HTTP layer for investigation endpoints.
 *
 * POST /investigations
 *   Runs a fraud investigation. Always HTTP 200 with { investigationId, report }
 *   (agent failures → riskLevel INCONCLUSIVE, never 5xx).
 *
 * POST /investigations/:id/member-verification
 *   Opens a simulated member verification for a stored investigation. No body:
 *   the policy gate evaluates the report the backend stored for :id.
 *
 * POST /investigations/:id/member-verification/confirm
 *   Records the associate's CONFIRMED or DENIED decision.
 *
 * GET /investigations/:id/member-verification
 *   Returns the current verification state.
 */
@Controller('investigations')
export class InvestigationController {
  constructor(
    private readonly investigationService: InvestigationService,
    private readonly verificationService: VerificationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Body(new ZodValidationPipe(createInvestigationSchema))
    input: CreateInvestigationInput,
  ): Promise<InvestigationResult> {
    return this.investigationService.investigate(input);
  }

  @Post(':id/member-verification')
  @HttpCode(HttpStatus.OK)
  requestVerification(
    @Param('id', investigationIdPipe) investigationId: string,
  ): VerificationRecord {
    return this.verificationService.requestVerification(investigationId);
  }

  @Post(':id/member-verification/confirm')
  @HttpCode(HttpStatus.OK)
  confirmVerification(
    @Param('id', investigationIdPipe) investigationId: string,
    @Body(new ZodValidationPipe(confirmVerificationSchema))
    input: ConfirmVerificationInput,
  ): VerificationRecord {
    return this.verificationService.confirmVerification(investigationId, input.decision);
  }

  @Get(':id/member-verification')
  getVerification(
    @Param('id', investigationIdPipe) investigationId: string,
  ): VerificationRecord {
    return this.verificationService.getVerification(investigationId);
  }
}
