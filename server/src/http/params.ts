import type { Router } from 'express';
import { notFoundError } from './errors.js';

/** Route ids are BIGSERIAL: anything non-numeric is a 404, not a database cast error. */
export function numericIdParams(router: Router, ...names: string[]): void {
  for (const name of names) {
    router.param(name, (_req, _res, next, value: string) => (/^\d{1,18}$/.test(value) ? next() : next(notFoundError())));
  }
}
