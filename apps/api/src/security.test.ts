import { describe, expect, it } from "vitest";
import { isBlockedAddress, validatePublicHttps } from "./security";

describe("remote URL policy", () => {
  it("blocks private IPv4", () => expect(isBlockedAddress("192.168.1.2")).toBe(true));
  it("blocks IPv6 loopback", () => expect(isBlockedAddress("::1")).toBe(true));
  it("rejects HTTP", async () => await expect(validatePublicHttps("http://example.com/media.m3u8")).rejects.toThrow("HTTPS"));
  it("accepts public HTTPS", async () => expect((await validatePublicHttps("https://example.com/media.m3u8")).hostname).toBe("example.com"));
});
