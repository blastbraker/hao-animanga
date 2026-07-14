import { describe, expect, it } from "vitest";
import { supportedEmailOtpType } from "./auth-callback";

describe("supportedEmailOtpType", () => {
  it("accepts Supabase email callback types", () => {
    expect(supportedEmailOtpType("invite")).toBe("invite");
    expect(supportedEmailOtpType("magiclink")).toBe("magiclink");
    expect(supportedEmailOtpType("recovery")).toBe("recovery");
  });

  it("rejects missing and unknown callback types", () => {
    expect(supportedEmailOtpType(null)).toBeNull();
    expect(supportedEmailOtpType("not-a-real-type")).toBeNull();
  });
});
