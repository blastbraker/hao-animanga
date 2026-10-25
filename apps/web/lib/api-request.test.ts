import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, bridgeFetch, bridgeMediaUrl, clearBridgeViewerPasses, getActiveBridge } from "./api";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./supabase", () => ({ getSupabaseBrowser: () => ({ auth: { getSession } }) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout, location: { protocol: "https:" } });
  getSession.mockResolvedValue({ data: { session: { access_token: "fixture-token" } } });
});
afterEach(() => {
  clearBridgeViewerPasses();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("API errors used for session revalidation", () => {
  it("sends only a device-scoped pass to the Bridge and its local media URLs", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/bridges")) return new Response(JSON.stringify({ items: [{ id: "bridge-one", endpoint: "https://bridge.example", scope: "beta", revokedAt: null }] }));
      if (url.endsWith("/health")) return new Response(JSON.stringify({ status: "ok", paired: true, viewerProtected: true }));
      if (url.endsWith("/bridges/bridge-one/access")) return new Response(JSON.stringify({ token: "media-only-pass", expiresAt: new Date(Date.now() + 21600_000).toISOString() }));
      return new Response("[]");
    });
    vi.stubGlobal("fetch", fetch);
    const bridge = await getActiveBridge();
    await bridgeFetch(bridge.endpoint, "/v1/anime/sources");
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    for (const [url, init] of calls.filter(([url]) => url.startsWith("https://bridge.example"))) {
      expect(new Headers(init?.headers).get("Authorization") ?? "", url).not.toContain("fixture-token");
    }
    expect(new Headers(calls.at(-1)?.[1].headers).get("Authorization")).toBe("Bearer media-only-pass");
    expect(bridgeMediaUrl(bridge.endpoint, "/v1/anime/streams/a/media")).toContain("hao_access=media-only-pass");
    expect(bridgeMediaUrl(bridge.endpoint, "https://external.example/media.mp4")).toBe("https://external.example/media.mp4");
  });
  it("allows guest metadata without sending a fake development identity", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ featured: [] })));
    vi.stubGlobal("fetch", fetch);
    await api("/discover");
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("x-user-id");
    await expect(api("/bridges")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 404])("preserves HTTP %s without retrying access/client failures", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Request denied" }), { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(api("/session")).rejects.toMatchObject({ name: "ApiRequestError", status, message: "Request denied" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a temporary failure without losing a subsequent access denial", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Access revoked" }), { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(api("/session")).rejects.toMatchObject({ status: 403, message: "Access revoked" });
    await vi.advanceTimersByTimeAsync(400);
    await result;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a missing production session as denied access, not a transient network failure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    getSession.mockResolvedValue({ data: { session: null } });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(api("/session")).rejects.toEqual(new ApiRequestError("Sign in required", 401));
    expect(fetch).not.toHaveBeenCalled();
  });
});
