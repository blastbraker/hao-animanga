import { z } from "zod";

const ProductionEnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").refine((value) => /^postgres(ql)?:\/\//.test(value), "DATABASE_URL must be PostgreSQL"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a URL").refine((value) => value.startsWith("https://"), "SUPABASE_URL must use HTTPS"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, "SUPABASE_SERVICE_ROLE_KEY is required"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must contain at least 32 characters"),
  WEB_ORIGIN: z.string().optional().refine((value) => value === undefined || (value.trim().length > 0 && validProductionOrigins(value)), "WEB_ORIGIN must contain HTTPS origins and cannot use localhost"),
});

export function validateProductionEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NODE_ENV !== "production") return;
  const result = ProductionEnvironmentSchema.safeParse(environment);
  const messages = result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  if (environment.VERCEL !== "1" && !environment.WEB_ORIGIN) messages.push("WEB_ORIGIN: WEB_ORIGIN is required outside Vercel");
  if (messages.length === 0) return;
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
