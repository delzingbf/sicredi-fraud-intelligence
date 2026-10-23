import type { INestApplication } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter.js';

/**
 * Applies the global setup used in production (main.ts).
 * Used by both bootstrap() and e2e test setup to prevent configuration drift.
 *
 * Request validation is per-route with ZodValidationPipe (ADR-005), so no
 * global ValidationPipe is registered.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalFilters(new GlobalExceptionFilter());
}
