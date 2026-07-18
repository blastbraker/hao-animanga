import { describe, expect, it } from "vitest";
import { buildInviteCallbackUrl, generateTemporaryPassword } from "./supabase.js";

describe("invite callback URLs", () => {
  it("builds a cross-browser token-hash invitation URL", () => {
    const result = new URL(buildInviteCallbackUrl("https://hao.example/", "hash/with+symbols="));

    expect(result.origin).toBe("https://hao.example");
    expect(result.pathname).toBe("/auth/callback");
    expect(result.searchParams.get("token_hash")).toBe("hash/with+symbols=");
    expect(result.searchParams.get("type")).toBe("invite");
    expect(result.hash).toBe("");
  });
  it("creates a strong temporary password", () => {
    const password = generateTemporaryPassword();
    expect(password.length).toBeGreaterThanOrEqual(20);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^a-zA-Z0-9]/);
  });
});
