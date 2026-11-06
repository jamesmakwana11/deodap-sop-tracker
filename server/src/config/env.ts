import 'dotenv/config';
import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  /** Folder for the JSON data files. Defaults to server/data. */
  DATA_DIR: optional,
  /** Public origin of the app, e.g. https://sop.deodap.com. Used for CORS, CSRF origin checks and links. */
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Number of reverse proxies in front of the app (for correct client IPs and secure cookies). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  COOKIE_SECURE: optional,

  // Meta Marketing API — all server-side only.
  META_APP_ID: optional,
  META_APP_SECRET: optional,
  META_REDIRECT_URI: optional,
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v26.0'),
  /** 32-byte key (64 hex chars or base64) used to encrypt Meta tokens at rest. */
  TOKEN_ENCRYPTION_KEY: optional,

  /** Daily sync time in IST, HH:MM. Empty disables the scheduler. */
  SYNC_TIME_IST: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .or(z.literal(''))
    .default('07:30'),
  /** Serve the built client from this directory in production. */
  CLIENT_DIST_DIR: optional,
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid server environment. Check server/.env:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction;
