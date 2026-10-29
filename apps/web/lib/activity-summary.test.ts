import { describe, expect, it } from "vitest";
import {
  activityDay,
  groupActivity,
  summarizeActivity,
} from "./activity-summary";
import type { ActivityEntry } from "./beta-features";
const item = (
  id: string,
  kind: "watch" | "read",
  date: Date,
): ActivityEntry => ({
  id,
  kind,
  title: id,
  detail: "Chapter 2",
  href: "/reader",
  sourceName: "Fixture",
  progressPercent: 20,
  updatedAt: date.toISOString(),
});
describe("activity presentation", () => {
  it("counts only recorded items within the last seven local calendar days", () => {
    const now = new Date(2026, 9, 28, 12);
    const summary = summarizeActivity(
      [
        item("A", "watch", now),
        item("B", "read", new Date(2026, 9, 22, 12)),
        item("Old", "read", new Date(2026, 9, 21, 12)),
      ],
      now,
    );
    expect(summary.watch).toBe(1);
    expect(summary.read).toBe(1);
    expect(summary.days).toHaveLength(7);
  });
  it("groups, sorts and filters history without mutating it", () => {
    const entries = [
      item("Earlier", "read", new Date(2026, 9, 27)),
      item("Recent", "watch", new Date(2026, 9, 28)),
    ];
    expect(groupActivity(entries, "all", "")[0]?.[1][0]?.title).toBe("Recent");
    expect(groupActivity(entries, "read", " fixture ")).toHaveLength(1);
    expect(groupActivity(entries, "watch", "absent")).toEqual([]);
    expect(entries[0]?.title).toBe("Earlier");
    expect(activityDay("bad")).toBe("Unknown date");
  });
});
