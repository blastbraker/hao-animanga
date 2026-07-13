import type { LibraryEntry, Work } from "@hao/domain";
import { getSupabaseBrowser } from "./supabase";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/v1";
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = getSupabaseBrowser();
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  const authHeaders = token ? { authorization: `Bearer ${token}` } : { "x-user-id": DEV_USER_ID };
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "content-type": "application/json", ...authHeaders, ...init?.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export type DiscoverResponse = { featured: Work[]; trending: Work[]; updated: Work[] };
export type LibraryResponse = { items: LibraryEntry[] };

type BridgeDevice = { endpoint: string; revokedAt: string | null };

export async function getActiveBridgeEndpoint(): Promise<string> {
  try {
    const { items } = await api<{ items: BridgeDevice[] }>("/bridges");
    const endpoint = items.find((item) => !item.revokedAt)?.endpoint?.replace(/\/$/, "");
    if (endpoint) return endpoint;
  } catch (cause) {
    if (process.env.NODE_ENV !== "development") throw cause;
  }
  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:4568";
  throw new Error("Pair HAO Bridge in Settings before browsing repository sources.");
}
