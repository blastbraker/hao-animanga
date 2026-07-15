import type { LibraryEntry, Work } from "@hao/domain";
import { getSupabaseBrowser } from "./supabase";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:4000/v1" : "/api/v1");
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export function bridgeFetch(endpoint: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("serveo-skip-browser-warning", "true");
  return fetch(`${endpoint}${path}`, { ...init, headers });
}

export class BridgeRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "BridgeRequestError";
  }
}

export async function bridgeJson<T>(endpoint: string, path: string, init?: RequestInit): Promise<T> {
  if (!endpoint.trim()) throw new BridgeRequestError("No HAO Bridge is connected. Open Settings to reconnect or ask the beta administrator to check the shared Bridge.");
  let response: Response;
  try {
    response = await bridgeFetch(endpoint.replace(/\/$/, ""), path, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError")
      throw new BridgeRequestError("The HAO Bridge took too long to respond. Retry once, then ask the beta administrator to check it.");
    throw new BridgeRequestError("The HAO Bridge is offline or unreachable. Retry in a moment. If this continues, ask the beta administrator to restart the shared Bridge.");
  }
  const payload = (await response.json().catch(() => null)) as ({ message?: unknown; title?: unknown; details?: unknown } & T) | null;
  if (!response.ok) {
    const detail = [payload?.message, payload?.title, payload?.details].find((value): value is string => typeof value === "string" && value.trim().length > 0);
    throw new BridgeRequestError(bridgeResponseMessage(response.status, detail), response.status);
  }
  return payload as T;
}

export function bridgeErrorMessage(cause: unknown, fallback = "The source could not complete this request."): string {
  if (cause instanceof BridgeRequestError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return fallback;
}

export function bridgeResponseMessage(status: number, detail?: string): string {
  const normalized = detail?.toLowerCase() ?? "";
  if (normalized.includes("anime source request was invalid") || normalized.includes("request was invalid"))
    return "This source could not understand that title or episode request. Search again or choose another result.";
  if (normalized.includes("bridge operation failed"))
    return "The extension could not complete this request. Retry once, then try another source or server.";
  if (status === 401 || status === 403)
    return "This source needs authentication or your beta access has expired. Check Settings or ask the beta administrator for access.";
  if (status === 404)
    return "This title, episode, or chapter is no longer available from this source. Try another result or source.";
  if (status === 408 || status === 504)
    return "The source took too long to respond. Retry once, then try another source or server.";
  if (status === 429)
    return "This source is receiving too many requests. Wait a minute, then retry.";
  if (status === 502 || status === 503)
    return "The source is temporarily unavailable. Retry shortly or choose another source.";
  if (status >= 500)
    return "The extension failed while handling this request. Retry once, then choose another source or server.";
  return detail?.trim() || `The Bridge rejected this request (${status}). Try another source.`;
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
