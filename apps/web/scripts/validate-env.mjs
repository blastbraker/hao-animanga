const shouldValidate = process.env.VERCEL === "1" || process.env.HAO_VALIDATE_PRODUCTION_ENV === "1";

if (shouldValidate) {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ENCRYPTION_KEY",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing production web environment: ${missing.join(", ")}`);
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
    const url = new URL(process.env[name]);
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      throw new Error(`${name} must use a public HTTPS URL in production`);
    }
  }
  if (process.env.NEXT_PUBLIC_API_URL) {
    const value = process.env.NEXT_PUBLIC_API_URL;
    if (value !== "/api/v1") {
      const url = new URL(value);
      if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
        throw new Error("NEXT_PUBLIC_API_URL must be /api/v1 or a public HTTPS URL in production");
      }
    }
  }
}
