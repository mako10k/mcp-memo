import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_BASE_URL: z.string().url().optional()
});

export type EnvVars = z.infer<typeof envSchema>;

export function parseEnv(env: Record<string, string | undefined>): EnvVars {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const message = result.error.format();
    throw new Error(`Invalid environment variables: ${JSON.stringify(message)}`);
  }
  return result.data;
}
