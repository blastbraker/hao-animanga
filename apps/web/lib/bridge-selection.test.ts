import { describe, expect, it, vi } from "vitest";
import { activeBridgeCandidates, selectReachableBridge, type BridgeAccess } from "./api";

const personal: BridgeAccess = {
  endpoint: "http://127.0.0.1:4568/",
  name: "Personal Bridge",
  scope: "personal",
  sharedBeta: false,
  revokedAt: null
};

const shared: BridgeAccess = {
  endpoint: "https://shared.example.test/",
  name: "Shared Bridge",
  scope: "beta",
  sharedBeta: true,
  revokedAt: null
};

describe("Bridge selection", () => {
  it("keeps personal preference while normalizing endpoints", () => {
    expect(activeBridgeCandidates([shared, personal]).map((item) => item.endpoint)).toEqual([
      "http://127.0.0.1:4568",
      "https://shared.example.test"
    ]);
  });

  it("falls back to the shared Bridge when a personal Bridge is unreachable", async () => {
    const probe = vi.fn(async (item: BridgeAccess) => item.scope === "beta");
    await expect(selectReachableBridge([personal, shared], probe)).resolves.toEqual({
      ...shared,
      endpoint: "https://shared.example.test"
    });
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("ignores revoked Bridge records", async () => {
    const probe = vi.fn(async () => true);
    await expect(selectReachableBridge([{ ...personal, revokedAt: new Date().toISOString() }, shared], probe)).resolves.toMatchObject({ scope: "beta" });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
