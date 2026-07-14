import type { LibraryEntry, Work } from "@hao/domain";
import { getSupabaseBrowser } from "./supabase";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:4000/v1" : "/api/v1");
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export function bridgeFetch(endpoint: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("serveo-skip-browser-warning", "true");
  return fetch(`${endpoint}${path}`, { ...init, headers });
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = getSupabaseBrowser();
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token && process.env.NODE_ENV === "production") throw new Error("Sign in required");
  const authHeaders = token ? { authorization: `Bearer ${token}` } : { "x-user-id": DEV_USER_ID };
  const contentHeaders = init?.body == null ? {} : { "content-type": "application/json" };
  const method = (init?.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = init?.signal ? null : new AbortController();
    const timeout = controller ? window.setTimeout(() => controller.abort(), 12_000) : null;
    try {
      const requestInit: RequestInit = {
        ...init,
        headers: {
          ...contentHeaders,
          ...authHeaders,
          ...init?.headers
        }
      };
      const signal = init?.signal ?? controller?.signal;
      if (signal) requestInit.signal = signal;
      const response = await fetch(`${API_URL}${path}`, requestInit);
      if (!response.ok) {
        const message = (await response.json().catch(() => null))?.message ?? `Request failed: ${response.status}`;
        if (attempt + 1 < attempts && [429, 502, 503, 504].includes(response.status)) {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          continue;
        }
        throw new Error(message);
      }
      return response.json() as Promise<T>;
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || init?.signal?.aborted) break;
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
    }
  }
  if (lastError instanceof DOMException && lastError.name === "AbortError") throw new Error("HAO API timed out. Please retry.");
  throw lastError instanceof Error ? lastError : new Error("HAO API request failed");
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
