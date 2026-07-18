export const ACTIVITY_STORAGE_KEY = "hao:activity:v1";
export const SOURCE_REPORTS_STORAGE_KEY = "hao:source-reports:v1";
export const RELEASE_SNAPSHOTS_STORAGE_KEY = "hao:release-snapshots:v1";
export const READER_BOOKMARKS_STORAGE_KEY = "hao:reader-bookmarks:v1";

export type ActivityKind = "watch" | "read";
export type ActivityEntry = {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  href: string;
  sourceName: string;
  progressPercent: number | null;
  updatedAt: string;
};

export type SourceIssueReport = {
  id: string;
  medium: "anime" | "manga";
  sourceId: string;
  sourceName: string;
  title: string;
  detail: string;
  pageUrl: string;
  createdAt: string;
};

export type ReaderBookmark = {
  id: string;
  title: string;
  chapterName: string;
  page: number;
  href: string;
  createdAt: string;
};

function parseArray<T>(raw: string | null, valid: (value: unknown) => value is T): T[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter(valid) : [];
  } catch {
    return [];
  }
}

export function parseActivity(raw: string | null): ActivityEntry[] {
  return parseArray(raw, (value): value is ActivityEntry => {
    const item = value as Partial<ActivityEntry> | null;
    return Boolean(item && (item.kind === "watch" || item.kind === "read") && typeof item.id === "string" && typeof item.title === "string" && typeof item.detail === "string" && typeof item.href === "string" && typeof item.updatedAt === "string");
  });
}

export function updateActivity(entries: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  return [entry, ...entries.filter((item) => item.id !== entry.id)].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 100);
}

export function recordActivity(entry: Omit<ActivityEntry, "updatedAt">, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(updateActivity(parseActivity(storage.getItem(ACTIVITY_STORAGE_KEY)), { ...entry, updatedAt: new Date().toISOString() })));
  } catch {
    /* Playback and reading continue when storage is unavailable. */
  }
}

export function parseSourceReports(raw: string | null): SourceIssueReport[] {
  return parseArray(raw, (value): value is SourceIssueReport => {
    const item = value as Partial<SourceIssueReport> | null;
    return Boolean(item && (item.medium === "anime" || item.medium === "manga") && typeof item.id === "string" && typeof item.sourceId === "string" && typeof item.detail === "string" && typeof item.createdAt === "string");
  });
}

export function saveSourceReport(report: Omit<SourceIssueReport, "id" | "createdAt">, storage: Storage = window.localStorage): SourceIssueReport {
  const createdAt = new Date().toISOString();
  const saved = { ...report, id: `${report.medium}:${report.sourceId}:${Date.now()}`, createdAt };
  const reports = [saved, ...parseSourceReports(storage.getItem(SOURCE_REPORTS_STORAGE_KEY))].slice(0, 50);
  storage.setItem(SOURCE_REPORTS_STORAGE_KEY, JSON.stringify(reports));
  return saved;
}

export function parseReaderBookmarks(raw: string | null): ReaderBookmark[] {
  return parseArray(raw, (value): value is ReaderBookmark => {
    const item = value as Partial<ReaderBookmark> | null;
    return Boolean(item && typeof item.id === "string" && typeof item.title === "string" && typeof item.chapterName === "string" && typeof item.page === "number" && typeof item.href === "string" && typeof item.createdAt === "string");
  });
}

export function toggleReaderBookmark(bookmarks: ReaderBookmark[], bookmark: ReaderBookmark): ReaderBookmark[] {
  return bookmarks.some((item) => item.id === bookmark.id) ? bookmarks.filter((item) => item.id !== bookmark.id) : [bookmark, ...bookmarks].slice(0, 100);
}

export function updateReleaseSnapshot(key: string, count: number, raw: string | null): { previous: number | null; snapshots: Record<string, number> } {
  let snapshots: Record<string, number> = {};
  try {
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) snapshots = Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "number" && Number.isFinite(value)) as [string, number][]);
  } catch {
    snapshots = {};
  }
  const previous = typeof snapshots[key] === "number" ? snapshots[key]! : null;
  return { previous, snapshots: { ...snapshots, [key]: Math.max(0, count) } };
}

export function maybeNotifyNewReleases(title: string, kind: "episode" | "chapter", previous: number | null, count: number): void {
  if (previous === null || count <= previous || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const added = count - previous;
  new Notification(`${title} has ${added} new ${kind}${added === 1 ? "" : "s"}`, { body: `${count} ${kind}${count === 1 ? "" : "s"} are now available in HAO.`, icon: "/brand/hao-logo-192.png" });
}
