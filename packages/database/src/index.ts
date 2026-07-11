import postgres from "postgres";
export { HaoRepository } from "./repository.js";

export type Database = ReturnType<typeof postgres>;

export function createDatabase(url = process.env.DATABASE_URL): Database | null {
  if (!url) return null;
  return postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 });
}
