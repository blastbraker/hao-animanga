import { describe, expect, it } from "vitest";
import { buildInviteCallbackUrl } from "./supabase.js";

describe("invite callback URLs", () => {
  it("builds a cross-browser token-hash invitation URL", () => {
    const result = new URL(buildInviteCallbackUrl("https://hao.example/", "hash/with+symbols="));

    expect(result.origin).toBe("https://hao.example");
    expect(result.pathname).toBe("/auth/callback");
    expect(result.searchParams.get("token_hash")).toBe("hash/with+symbols=");
    expect(result.searchParams.get("type")).toBe("invite");
    expect(result.hash).toBe("");
  });
});
