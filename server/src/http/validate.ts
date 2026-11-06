import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses input with a zod schema; the first issue becomes a 400 message. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.');
    throw badRequest(field ? `${field}: ${issue?.message}` : (issue?.message ?? 'Invalid request.'));
  }
  return result.data;
}
