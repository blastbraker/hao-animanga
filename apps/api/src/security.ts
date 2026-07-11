import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function blockedIpv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function blockedIpv6(ip: string): boolean {
  const value = ip.toLocaleLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("ff");
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  return family === 4 ? blockedIpv4(ip) : family === 6 ? blockedIpv6(ip) : true;
}

export async function validatePublicHttps(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("HTTPS is required");
  if (url.username || url.password) throw new Error("Credentials in URLs are not allowed");
  if (!url.hostname) throw new Error("A hostname is required");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address))) throw new Error("Private and reserved destinations are not allowed");
  return url;
}

export async function safeProviderFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  const url = await validatePublicHttps(raw);
  return fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });
}
