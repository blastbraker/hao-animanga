import type { ActivityEntry } from "./beta-features";

export function activityDay(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown date";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** History records are recently opened items, not verified completed episodes. */
export function summarizeActivity(items: ActivityEntry[], now = new Date()) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - 6 + index);
    const key = activityDay(date.toISOString());
    const entries = items.filter((item) => activityDay(item.updatedAt) === key);
    return {
      key,
      label: date.toLocaleDateString("en", { weekday: "short" }),
      watch: entries.filter((item) => item.kind === "watch").length,
      read: entries.filter((item) => item.kind === "read").length,
    };
  });
  return {
    days,
    watch: days.reduce((sum, day) => sum + day.watch, 0),
    read: days.reduce((sum, day) => sum + day.read, 0),
  };
}

export function groupActivity(
  items: ActivityEntry[],
  kind: "all" | "watch" | "read",
  query: string,
) {
  const groups = new Map<string, ActivityEntry[]>();
  for (const item of [...items].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )) {
    if (kind !== "all" && item.kind !== kind) continue;
    if (
      query.trim() &&
      !`${item.title} ${item.detail} ${item.sourceName}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    )
      continue;
    const day = activityDay(item.updatedAt);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return [...groups];
}
