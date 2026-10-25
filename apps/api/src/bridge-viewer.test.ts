import { afterEach, describe, expect, it, vi } from "vitest";
import { importJWK, jwtVerify } from "jose";
import { bridgeViewerKeys, createBridgeViewerToken } from "./bridge-viewer";

afterEach(() => vi.unstubAllEnvs());
describe("Bridge viewer passes", () => {
  it("is signed, media-only, device-bound, and expires after six hours", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "fixture-encryption-secret-32-characters");
    vi.stubEnv("WEB_ORIGIN", "https://hao.example");
    const { token } = await createBridgeViewerToken("tester", "device-one");
    const jwk = bridgeViewerKeys().keys[0]!;
    expect(jwk).not.toHaveProperty("d");
    const key = await importJWK(jwk, "EdDSA");
    const { payload } = await jwtVerify(token, key, { issuer: "https://hao.example/bridge-viewer", audience: "device-one" });
    expect(payload).toMatchObject({ sub: "tester", scope: "bridge:read" });
    expect(payload.exp! - payload.iat!).toBe(21600);
    await expect(jwtVerify(token, key, { audience: "another-bridge" })).rejects.toThrow();
    await expect(jwtVerify(token, key, { currentDate: new Date(Date.now() + 21601_000) })).rejects.toThrow();
  });
});
