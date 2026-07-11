import { validatePublicHttps } from "./security.js";

export interface JellyfinConnection { id: string; name: string; endpoint: string; apiKey: string; serverName: string; version: string }

export async function testJellyfin(endpoint: string, apiKey: string): Promise<{ serverName: string; version: string }> {
  const base = await validatePublicHttps(endpoint);
  const url = new URL("System/Info", base.toString().endsWith("/") ? base : `${base}/`);
  const response = await fetch(url, { headers: { "X-Emby-Token": apiKey, accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (response.status === 401 || response.status === 403) throw new Error("Jellyfin rejected the API key");
  if (!response.ok) throw new Error(`Jellyfin returned HTTP ${response.status}`);
  const body = await response.json() as { ServerName?: string; Version?: string };
  return { serverName: body.ServerName ?? base.hostname, version: body.Version ?? "unknown" };
}
