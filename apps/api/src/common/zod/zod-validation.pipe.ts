import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { formatZodIssues } from './format-zod-issues.js';

/**
 * Validates and parses a request value with a Zod schema (ADR-005).
 *
 * Usage: @Body(new ZodValidationPipe(schema)) input: z.infer<typeof schema>
 *
 * Throws BadRequestException with field-level messages on failure.
 */
export class ZodValidationPipe<T extends z.ZodTypeAny>
  implements PipeTransform<unknown, z.infer<T>>
{
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(formatZodIssues(result.error));
    }
    return result.data;
  }
}
