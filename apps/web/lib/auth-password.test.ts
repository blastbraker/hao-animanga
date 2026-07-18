import { describe, expect, it } from "vitest";
import { passwordValidation } from "./auth-password";

describe("passwordValidation", () => {
  it("accepts matching strong passwords", () => expect(passwordValidation("StrongPass123", "StrongPass123")).toBeNull());
  it("rejects short, weak, and mismatched passwords", () => {
    expect(passwordValidation("Short1A", "Short1A")).toContain("10 characters");
    expect(passwordValidation("alllowercase123", "alllowercase123")).toContain("uppercase");
    expect(passwordValidation("StrongPass123", "StrongPass124")).toContain("do not match");
  });
});
