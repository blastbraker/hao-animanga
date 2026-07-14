import type { LibraryEntry, Work } from "@hao/domain";
import { getSupabaseBrowser } from "./supabase";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:4000/v1" : "/api/v1");
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = getSupabaseBrowser();
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token && process.env.NODE_ENV === "production") throw new Error("Sign in required");
  const authHeaders = token ? { authorization: `Bearer ${token}` } : { "x-user-id": DEV_USER_ID };
  const contentHeaders = init?.body == null ? {} : { "content-type": "application/json" };
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...contentHeaders,
      ...authHeaders,
      ...init?.headers
    }
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `Request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export type DiscoverResponse = {
  featured: Work[];
  trending: Work[];
  updated: Work[];
};
export type LibraryResponse = { items: LibraryEntry[] };

export type BridgeAccess = {
  endpoint: string;
  name: string;
  scope: "personal" | "beta";
  sharedBeta: boolean;
  revokedAt: string | null;
};

export async function getActiveBridge(): Promise<BridgeAccess> {
  try {
    const { items } = await api<{ items: BridgeAccess[] }>("/bridges");
    const personal = items.find((item) => item.scope === "personal" && !item.revokedAt && item.endpoint);
    const shared = items.find((item) => item.scope === "beta" && !item.revokedAt && item.endpoint);
    const selected = personal ?? shared;
    if (selected) return { ...selected, endpoint: selected.endpoint.replace(/\/$/, "") };
  } catch (cause) {
    if (process.env.NODE_ENV !== "development") throw cause;
  }
  if (process.env.NODE_ENV === "development")
    return {
      endpoint: "http://127.0.0.1:4568",
      name: "Local HAO Bridge",
      scope: "personal",
      sharedBeta: false,
      revokedAt: null
    };
  throw new Error("No personal or managed Beta Bridge is available. Ask the beta administrator to check the shared Bridge.");
}

export async function getActiveBridgeEndpoint(): Promise<string> {
  return (await getActiveBridge()).endpoint;
}
