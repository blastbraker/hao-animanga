import { describe, expect, it } from "vitest";
import { isWorkAllowed, workMaturity } from "./profile-preferences";

describe("maturity controls", () => {
  it("normalizes common catalog ratings", () => {
    expect(workMaturity({ maturityRating: "PG-13", genres: [] })).toBe("TEEN");
    expect(workMaturity({ maturityRating: "18+", genres: [] })).toBe("ADULT");
  });
  it("can hide unknown and above-ceiling titles", () => {
    expect(isWorkAllowed({ maturityRating: "MATURE", genres: [] }, { maturityCeiling: "TEEN", hideUnrated: false })).toBe(false);
    expect(isWorkAllowed({ maturityRating: null, genres: [] }, { maturityCeiling: "ADULT", hideUnrated: true })).toBe(false);
  });
});

