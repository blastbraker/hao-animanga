import { describe, expect, it } from "vitest";
import { safeNextDestination } from "./auth-redirect";

describe("safeNextDestination", () => {
  it("keeps internal paths and query strings", () => {
    expect(safeNextDestination("/library?status=watching")).toBe("/library?status=watching");
  });

  it("rejects absolute and protocol-relative redirects", () => {
    expect(safeNextDestination("https://evil.example/path")).toBe("/");
    expect(safeNextDestination("//evil.example/path")).toBe("/");
  });
});
