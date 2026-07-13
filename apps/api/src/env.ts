import { z } from "zod";

const ProductionEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").refine((value) => /^postgres(ql)?:\/\//.test(value), "DATABASE_URL must be PostgreSQL"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a URL").refine((value) => value.startsWith("https://"), "SUPABASE_URL must use HTTPS"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, "SUPABASE_SERVICE_ROLE_KEY is required"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must contain at least 32 characters"),
  WEB_ORIGIN: z.string().min(1, "WEB_ORIGIN is required").refine(validProductionOrigins, "WEB_ORIGIN must contain HTTPS origins and cannot use localhost"),
});

export function validateProductionEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NODE_ENV !== "production") return;
  const result = ProductionEnvironmentSchema.safeParse(environment);
  if (result.success) return;
  const messages = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid production environment:\n- ${messages.join("\n- ")}`);
}

function validProductionOrigins(value: string): boolean {
  return value.split(",").map((origin) => origin.trim()).filter(Boolean).every((origin) => {
    try {
      const url = new URL(origin);
      return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    } catch {
      return false;
    }
  });
}
