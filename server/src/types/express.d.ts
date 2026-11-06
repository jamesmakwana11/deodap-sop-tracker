import type { AuthUser } from '@sop/shared';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionToken?: string;
    }
  }
}

export {};
