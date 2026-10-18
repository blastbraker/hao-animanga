import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "./api";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./supabase", () => ({ getSupabaseBrowser: () => ({ auth: { getSession } }) }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  getSession.mockResolvedValue({ data: { session: { access_token: "fixture-token" } } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("API errors used for session revalidation", () => {
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
