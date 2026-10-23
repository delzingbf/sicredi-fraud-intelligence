import type { ZodError } from 'zod';

/** Flattens Zod issues into "path: message" strings. Root-level issues use "(root)". */
export function formatZodIssues(error: ZodError): string[] {
  return error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
  );
}
