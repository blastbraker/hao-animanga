import { describe, expect, it } from "vitest";
import { normalizeTitle, progressPercent, titleMatchScore, type Work } from "./index";

const base = { title: "Frieren: Beyond Journey's End", alternateTitles: ["Sousou no Frieren"], kind: "ANIME", year: 2023 } satisfies Pick<Work, "title" | "alternateTitles" | "kind" | "year">;

describe("domain helpers", () => {
  it("normalizes punctuation", () => expect(normalizeTitle("  FRIEREN: Beyond! ")).toBe("frieren beyond"));
  it("matches equivalent titles", () => expect(titleMatchScore(base, { ...base, title: "Sousou no Frieren" })).toBeGreaterThan(0.9));
  it("does not match different media", () => expect(titleMatchScore(base, { ...base, kind: "MANGA" })).toBe(0));
  it("clamps progress", () => expect(progressPercent(13, 12)).toBe(100));
});
