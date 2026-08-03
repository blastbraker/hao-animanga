import { describe, expect, it } from "vitest";
import { mangaOfflineKey, offlineBytes, parseOfflineItems } from "./offline-library";

describe("offline library metadata", () => {
  it("uses stable per-chapter keys", () => expect(mangaOfflineKey("source", 12, 4)).toBe("manga:source:12:4"));
  it("totals storage and rejects malformed metadata", () => {
    expect(offlineBytes([{ key: "a", kind: "EPUB", title: "A", releaseLabel: "", byteSize: 12, itemCount: 1, savedAt: "now" }])).toBe(12);
    expect(parseOfflineItems("broken")).toEqual([]);
  });
});

