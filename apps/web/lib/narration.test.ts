import { describe, expect, it } from "vitest";
import { restoreListeningPosition } from "./narration";

const manifest = {
  id: "session",
  fingerprint: "v1",
  title: "Chapter",
  passages: ["One", "Two", "Three"],
};
const voices = [
  { id: "af_heart", name: "Heart", language: "English" },
  { id: "bf_emma", name: "Emma", language: "English" },
];
describe("Kokoro listening position", () => {
  it("resumes the exact passage and timestamp", () => {
    expect(
      restoreListeningPosition(
        {
          chapterId: "c1",
          fingerprint: "v1",
          index: 1,
          seconds: 8,
          voice: "bf_emma",
          rate: 1.5,
        },
        "c1",
        manifest,
        voices,
      ),
    ).toMatchObject({ index: 1, seconds: 8, voice: "bf_emma", rate: 1.5 });
  });
  it("never applies a previous chapter's timestamp to a new chapter", () => {
    expect(
      restoreListeningPosition(
        {
          chapterId: "old",
          fingerprint: "v1",
          index: 2,
          seconds: 8,
          voice: "bf_emma",
        },
        "c1",
        manifest,
        voices,
      ),
    ).toMatchObject({ index: 0, seconds: 0, voice: "bf_emma" });
  });
  it("starts fresh when the source changes its chapter text", () => {
    expect(
      restoreListeningPosition(
        { chapterId: "c1", fingerprint: "old", index: 2, seconds: 8 },
        "c1",
        manifest,
        voices,
      ).index,
    ).toBe(0);
  });
  it("rejects nonfinite positions and unknown voices", () => {
    expect(
      restoreListeningPosition(
        {
          chapterId: "c1",
          fingerprint: "v1",
          index: NaN,
          seconds: Infinity,
          voice: "custom",
          rate: -4,
        },
        "c1",
        manifest,
        voices,
      ),
    ).toMatchObject({ index: 0, seconds: 0, voice: "af_heart", rate: 0.5 });
  });
});
