import { z } from 'zod';
import { registerAs } from '@nestjs/config';

/**
 * Zod schema for environment variable validation.
 * The app fails to start with a clear message if required vars are missing.
 */
const envSchema = z.object({
  // IBM watsonx.ai
  IBM_PROJECT_ID: z.string().min(1, 'IBM_PROJECT_ID is required'),
  IBM_ACCESS_TOKEN: z.string().min(1, 'IBM_ACCESS_TOKEN is required'),
  IBM_CHAT_API_URL: z
    .string()
    .url()
    .default(
      'https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-10-08',
    ),
  IBM_MODEL_ID: z.string().default('ibm/granite-4-h-small'),

  // Agent behaviour
  MAX_INVESTIGATION_ROUNDS: z.coerce.number().int().min(1).max(20).default(8),
  INVESTIGATION_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(30_000),

  // Server
  PORT: z.coerce.number().int().default(3001),

  // Database
  DATABASE_URL: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Called by ConfigModule to validate process.env at startup.
 * Throws a descriptive error if required variables are missing.
 */
export function validate(config: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Environment variable validation failed:\n${issues}\n\nSee .env.example for reference.`,
    );
  }

  return result.data;
}

/**
 * Typed config factory registered as 'app'.
 * Inject with: @Inject(appConfig.KEY) private config: ConfigType<typeof appConfig>
 */
export const appConfig = registerAs('app', (): AppEnv => {
  // validate() already ran — process.env values are safe to read here
  return envSchema.parse(process.env);
});
