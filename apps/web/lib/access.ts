import { safeNextDestination } from "./auth-redirect";

export function isPublicPage(path: string): boolean {
  return ["/", "/discover", "/reader", "/novels"].includes(path) || /^\/title\/[^/]+$/.test(path);
}

export function isPublicApiRequest(path: string, method = "GET"): boolean {
  if (method.toUpperCase() === "POST") return path === "/auth/signup";
  if (method.toUpperCase() !== "GET") return false;
  const pathname = path.split("?")[0];
  return pathname === "/discover" || pathname === "/search" ||
    /^\/works\/(?:anilist\/\d+|[\da-f-]+(?:\/(?:seasons|anime-details))?)$/i.test(pathname ?? "");
}

export function authHref(mode: "login" | "signup", destination: string): string {
  return `/${mode}?next=${encodeURIComponent(safeNextDestination(destination))}`;
}
