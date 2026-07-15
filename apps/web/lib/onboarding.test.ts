import { describe, expect, it } from "vitest";
import { BETA_ONBOARDING_STORAGE_KEY, hasCompletedBetaOnboarding } from "./onboarding";

describe("beta onboarding", () => {
  it("opens until the current tour version is completed", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    expect(hasCompletedBetaOnboarding(storage)).toBe(false);
    values.set(BETA_ONBOARDING_STORAGE_KEY, "complete");
    expect(hasCompletedBetaOnboarding(storage)).toBe(true);
  });
});
