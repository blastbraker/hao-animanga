import postgres from "postgres";
export { HaoRepository } from "./repository.js";

export type Database = ReturnType<typeof postgres>;

export function createDatabase(url = process.env.DATABASE_URL): Database | null {
  if (!url) return null;
  const defaultPoolSize = process.env.VERCEL === "1" ? 1 : 10;
  const configuredPoolSize = Number(process.env.DATABASE_POOL_SIZE ?? defaultPoolSize);
  return postgres(url, {
    max: Number.isInteger(configuredPoolSize) && configuredPoolSize > 0 ? configuredPoolSize : defaultPoolSize,
    prepare: process.env.VERCEL !== "1",
    idle_timeout: process.env.VERCEL === "1" ? 5 : 20,
    max_lifetime: process.env.VERCEL === "1" ? 60 : 60 * 30,
    connect_timeout: 10,
  });
}
