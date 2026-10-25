import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignupSchema, inviteCodeMatches } from "./signup";

const mocks = vi.hoisted(() => ({ consume: vi.fn(), create: vi.fn(), audit: vi.fn() }));
vi.mock("@hao/database", () => ({
  createDatabase: () => ({ end: vi.fn() }),
  HaoRepository: class { consumeSignupAttempts = mocks.consume; audit = mocks.audit; },
}));
vi.mock("./supabase.js", async (original) => ({ ...await original<typeof import("./supabase")>(), createBetaAccount: mocks.create }));
import { buildApp } from "./app";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("HAO_BETA_INVITE_CODE_HASH", createHash("sha256").update("TEST-INVITE").digest("hex"));
  mocks.consume.mockResolvedValue(true); mocks.create.mockResolvedValue("fixture-user"); mocks.audit.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
const valid = { email: "tester@example.com", password: "SecureBetaPassword123", inviteCode: "TEST-INVITE" };
async function signup(payload: Record<string, unknown>) {
  const app = buildApp();
  try { return await app.inject({ method: "POST", url: "/v1/auth/signup", payload }); }
  finally { await app.close(); }
}

describe("invite-code signup", () => {
  it("creates only a member through the server after consuming shared limits", async () => {
    const response = await signup(valid);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ created: true });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(mocks.create).toHaveBeenCalledWith(valid.email, valid.password);
    expect(JSON.stringify(mocks.consume.mock.calls)).not.toContain(valid.email);
  });
  it.each([undefined, "", "wrong", "test-invite"])("rejects a missing or incorrect code: %s", async (inviteCode) => {
    expect((await signup({ ...valid, inviteCode })).statusCode).toBe(inviteCode ? 403 : 400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects role and app-metadata injection", async () => {
    expect((await signup({ ...valid, role: "admin", app_metadata: { invited: true } })).statusCode).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects weak passwords", async () => {
    expect((await signup({ ...valid, password: "short" })).statusCode).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("fails closed when signup is disabled", async () => {
    vi.stubEnv("HAO_BETA_INVITE_CODE_HASH", "");
    expect((await signup(valid)).statusCode).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("enforces shared database throttles before checking a code", async () => {
    mocks.consume.mockResolvedValue(false);
    const response = await signup(valid);
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("3600");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not reveal whether an email already exists or reset its password", async () => {
    mocks.create.mockRejectedValue(new Error("User already registered: private data"));
    const response = await signup(valid);
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("private data");
  });
  it("compares only configured hashes, with optional surrounding whitespace", () => {
    expect(inviteCodeMatches(" TEST-INVITE ")).toBe(true);
    expect(inviteCodeMatches("TEST-INVITE", "invalid")).toBe(false);
    expect(SignupSchema.safeParse({ ...valid, password: "A1a".repeat(100) }).success).toBe(false);
  });
});
