import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  DATABASE_MIGRATION_URL: z.string().url().optional(),
  REDIS_URL: z.string(),
  QUEUE_REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  REFRESH_TOKEN_PEPPER: z.string().min(32),
  OUTBOX_ENCRYPTION_KEY: z.string().min(32),
  COOKIE_DOMAIN: z.string().default('localhost'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  TRAIN_DATA_PROVIDER: z.enum(['railradar', 'fixture']).default('fixture'),
  RAILRADAR_API_KEY: z.string().optional(),
  RAILRADAR_MONTHLY_BUDGET: z.coerce.number().int().positive().default(100),
  RAILRADAR_MINUTE_LIMIT: z.coerce.number().int().positive().default(10),
  RESEND_API_KEY: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().default('1x00000000000000000000AA'),
  TURNSTILE_SECRET_KEY: z.string().default('1x0000000000000000000000000000000AA'),
  HOLD_TTL_SECONDS: z.coerce.number().default(600),
  PAYMENT_EXTENSION_SECONDS: z.coerce.number().default(300),
  BOOKING_WINDOW_DAYS: z.coerce.number().default(60),
  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(data: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}
