import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * GlobalExceptionFilter — catches all unhandled exceptions and returns a
 * consistent JSON error envelope.
 *
 * Registered globally by configureApp() (configure-app.ts).
 *
 * Rules:
 *   - HttpExceptions  → forward their status code and message as-is
 *   - Everything else → 500, generic message (no stack trace to the client)
 *
 * Note: InvestigationService is designed to never throw — agent failures are
 * returned as INCONCLUSIVE reports. This filter is the safety net for genuine
 * infrastructure failures (DB down, misconfiguration, etc.).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const bodyMessage = (body as { message?: string | string[] }).message;
        message = Array.isArray(bodyMessage)
          ? bodyMessage.join('; ')
          : (bodyMessage ?? exception.message);
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'An unexpected error occurred';
      // Log the full error server-side but never expose it to the client
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
