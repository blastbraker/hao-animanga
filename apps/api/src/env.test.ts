import { describe, expect, it } from "vitest";
import { validateProductionEnvironment } from "./env";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://hao:secret@db.example.com:5432/hao",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-with-enough-characters",
  ENCRYPTION_KEY: "a-secure-encryption-key-at-least-32-characters",
  WEB_ORIGIN: "https://beta.hao.example",
};

describe("production environment", () => {
  it("accepts a complete HTTPS production configuration", () => {
    expect(() => validateProductionEnvironment(production)).not.toThrow();
  });

  it("uses same-origin routing on Vercel without a fixed web origin", () => {
    expect(() => validateProductionEnvironment({ ...production, VERCEL: "1", WEB_ORIGIN: undefined })).not.toThrow();
  });

  it("requires a fixed web origin for a standalone server", () => {
    expect(() => validateProductionEnvironment({ ...production, WEB_ORIGIN: undefined })).toThrow(/WEB_ORIGIN/);
  });

  it("rejects missing secrets and local origins", () => {
    expect(() => validateProductionEnvironment({ ...production, ENCRYPTION_KEY: "", WEB_ORIGIN: "http://localhost:3000" })).toThrow(/ENCRYPTION_KEY/);
  });

  it("does not require managed services in development", () => {
    expect(() => validateProductionEnvironment({ NODE_ENV: "development" })).not.toThrow();
  });
});
