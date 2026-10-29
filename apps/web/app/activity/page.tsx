"use client";

import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Bell,
  BookOpen,
  CheckCircle2,
  Film,
  Gauge,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ACTIVITY_STORAGE_KEY,
  parseActivity,
  parseReaderBookmarks,
  parseSourceReports,
  READER_BOOKMARKS_STORAGE_KEY,
  SOURCE_REPORTS_STORAGE_KEY,
  type ActivityEntry,
  type ReaderBookmark,
  type SourceIssueReport,
} from "../../lib/beta-features";
import {
  readSourceReliability,
  reliabilityScore,
  type SourceReliabilityMap,
} from "../../lib/source-reliability";
import {
  api,
  bridgeJson,
  getActiveBridge,
  type LibraryResponse,
} from "../../lib/api";
import type { LibraryEntry } from "@hao/domain";
import {
  activityDay,
  groupActivity,
  summarizeActivity,
} from "../../lib/activity-summary";

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [reports, setReports] = useState<SourceIssueReport[]>([]);
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [reliability, setReliability] = useState<SourceReliabilityMap>({});
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({});
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unavailable"
  >("unavailable");
  const [kind, setKind] = useState<"all" | "watch" | "read">("all");
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    void api<LibraryResponse>("/library")
      .then((response) => {
        if (!cancelled) setLibrary(response.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      setItems(
        parseActivity(window.localStorage.getItem(ACTIVITY_STORAGE_KEY)),
      );
      setReports(
        parseSourceReports(
          window.localStorage.getItem(SOURCE_REPORTS_STORAGE_KEY),
        ),
      );
      setBookmarks(
        parseReaderBookmarks(
          window.localStorage.getItem(READER_BOOKMARKS_STORAGE_KEY),
        ),
      );
      setReliability(readSourceReliability());
      setNotificationPermission(
        typeof Notification === "undefined"
          ? "unavailable"
          : Notification.permission,
      );
    };
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void getActiveBridge()
      .then(async ({ endpoint }) => {
        const [anime, manga] = await Promise.allSettled([
          bridgeJson<Array<{ id: string; name: string }>>(
            endpoint,
            "/v1/anime/sources",
          ),
          bridgeJson<
            Array<{ id: string; name?: string; displayName?: string }>
          >(endpoint, "/v1/manga/sources"),
        ]);
        if (cancelled) return;
        const names: Record<string, string> = {};
        if (anime.status === "fulfilled")
          anime.value.forEach((source) => {
            names[`anime:${source.id}`] = source.name;
          });
        if (manga.status === "fulfilled")
          manga.value.forEach((source) => {
            names[`manga:${source.id}`] =
              source.displayName ?? source.name ?? "Manga source";
          });
        setSourceNames(names);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const sources = useMemo(
    () =>
      Object.entries(reliability).sort(
        ([, left], [, right]) =>
          reliabilityScore(right) - reliabilityScore(left),
      ),
    [reliability],
  );
  async function enableNotifications() {
    if (typeof Notification !== "undefined")
      setNotificationPermission(await Notification.requestPermission());
  }
  const summary = summarizeActivity(items);
  const groups = groupActivity(items, kind, query);
  const completed = library
    .filter((entry) => entry.status === "COMPLETED")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const peak = Math.max(
    1,
    ...summary.days.flatMap((day) => [day.watch, day.read]),
  );
  return (
    <div className="page inner-page activity-page browse-design">
      <div className="browse-heading">
        <div>
          <h1>Your activity</h1>
          <p>Your watching and reading, in one place.</p>
        </div>
        <button
          className="button ghost"
          onClick={() => void enableNotifications()}
          disabled={
            notificationPermission === "granted" ||
            notificationPermission === "unavailable"
          }
        >
          <Bell size={17} />
          {notificationPermission === "granted"
            ? "Notifications on"
            : "Enable releases"}
        </button>
      </div>
      <div className="activity-summary-grid">
        <article>
          <span>
            <Film size={19} /> Watching · last 7 days
          </span>
          <strong>
            {summary.watch}
            <small>recently opened</small>
          </strong>
          <div className="stat-accent" />
        </article>
        <article>
          <span>
            <BookOpen size={19} /> Reading · last 7 days
          </span>
          <strong>
            {summary.read}
            <small>recently opened</small>
          </strong>
          <div className="stat-accent violet" />
        </article>
        <article>
          <span>
            <CheckCircle2 size={19} /> Completed library
          </span>
          <strong>
            {completed.length}
            <small>titles marked finished</small>
          </strong>
          <div className="stat-accent gold" />
        </article>
      </div>
      <div className="activity-history-layout">
        <section className="activity-section activity-timeline">
          <div className="activity-filter-bar">
            <div className="browse-tabs" aria-label="History type">
              {(
                [
                  ["all", "All"],
                  ["watch", "Watching"],
                  ["read", "Reading"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={kind === value}
                  className={kind === value ? "active" : ""}
                  onClick={() => setKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="browse-search">
              <Search size={17} />
              <input
                aria-label="Search activity"
                placeholder="Search your history…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <p className="history-note">
            Recently opened on this device. Your library progress syncs
            separately.
          </p>
          {groups.length ? (
            groups.map(([day, entries]) => (
              <div className="timeline-day" key={day}>
                <h2>{dayLabel(day)}</h2>
                {entries.map((item) => {
                  const cover = library.find(
                    (entry) => entry.work.title === item.title,
                  )?.work.coverUrl;
                  return (
                    <Link
                      href={item.href}
                      key={item.id}
                      className="activity-row"
                    >
                      <span className={`activity-icon ${item.kind}`}>
                        {cover ? (
                          <img src={cover} alt="" loading="lazy" />
                        ) : item.kind === "watch" ? (
                          <Film />
                        ) : (
                          <BookOpen />
                        )}
                      </span>
                      <span>
                        <b>{item.title}</b>
                        <small>{item.detail}</small>
                        <time dateTime={item.updatedAt}>
                          {relativeTime(item.updatedAt)}
                        </time>
                      </span>
                      <span className="resume-action">
                        Resume <ArrowUpRight size={14} />
                      </span>
                    </Link>
                  );
                })}
              </div>
            ))
          ) : (
            <Empty
              icon={<Activity />}
              title={
                items.length ? "No matching activity" : "Your timeline is ready"
              }
              copy={
                items.length
                  ? "Try another search or history filter."
                  : "Start an episode or open a chapter and it will appear here."
              }
            />
          )}
        </section>
        <aside className="activity-insights">
          <section className="activity-section">
            <div className="section-head">
              <h2>Last 7 days</h2>
            </div>
            <div
              className="weekly-chart"
              role="img"
              aria-label={summary.days
                .map(
                  (day) =>
                    `${day.label}: ${day.watch} watching, ${day.read} reading`,
                )
                .join("; ")}
            >
              {summary.days.map((day) => (
                <div
                  key={day.key}
                  title={`${day.label}: ${day.watch} watching, ${day.read} reading`}
                >
                  <div>
                    <i style={{ height: `${(day.watch / peak) * 100}%` }} />
                    <i style={{ height: `${(day.read / peak) * 100}%` }} />
                  </div>
                  <small>{day.label}</small>
                </div>
              ))}
            </div>
            <p className="chart-legend">
              <span>Watching</span>
              <span>Reading</span>
            </p>
          </section>
          <section className="activity-section">
            <div className="section-head">
              <h2>Recently completed</h2>
            </div>
            {completed.length ? (
              <div className="completed-mini-list">
                {completed.slice(0, 4).map((entry) => (
                  <Link
                    key={entry.id}
                    href={`/title/${entry.work.id}${entry.work.source.kind === "ANILIST" ? `?anilistId=${entry.work.source.externalId}` : ""}`}
                  >
                    <img src={entry.work.coverUrl ?? "/icon.svg"} alt="" />
                    <span>
                      <b>{entry.work.title}</b>
                      <small>{entry.work.kind.replaceAll("_", " ")}</small>
                    </span>
                    <CheckCircle2 size={16} />
                  </Link>
                ))}
              </div>
            ) : (
              <Empty
                icon={<CheckCircle2 />}
                title="A fresh start"
                copy="Finished titles from your library appear here."
              />
            )}
          </section>
        </aside>
      </div>
      <div className="activity-columns">
        <section className="activity-section">
          <div className="section-head">
            <div>
              <span className="eyebrow">SMART FAILOVER</span>
              <h2>Source health</h2>
            </div>
            <Gauge />
          </div>
          {sources.length ? (
            <div className="health-list">
              {sources.map(([key, source]) => (
                <div className="source-health" key={key}>
                  <span
                    className={
                      source.consecutiveFailures
                        ? "health-dot"
                        : "health-dot good"
                    }
                  />
                  <span>
                    <b>{sourceLabel(key, sourceNames, items)}</b>
                    <small>
                      {source.successes} successful · {source.failures} failed ·{" "}
                      {Math.round(source.averageLatencyMs)} ms
                    </small>
                  </span>
                  <strong>
                    {reliabilityScore(source) >= 30
                      ? "Healthy"
                      : source.consecutiveFailures
                        ? "Degraded"
                        : "Learning"}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={<Gauge />}
              title="Health checks are learning"
              copy="HAO ranks sources automatically as you browse and play."
            />
          )}
        </section>
        <section className="activity-section">
          <div className="section-head">
            <div>
              <span className="eyebrow">SAVED PAGES</span>
              <h2>Reader bookmarks</h2>
            </div>
            <BookOpen />
          </div>
          {bookmarks.length ? (
            <div className="compact-list">
              {bookmarks.slice(0, 8).map((bookmark) => (
                <Link href={bookmark.href} key={bookmark.id}>
                  <CheckCircle2 />
                  <span>
                    <b>{bookmark.title}</b>
                    <small>
                      {bookmark.chapterName} · page {bookmark.page}
                    </small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              icon={<BookOpen />}
              title="No bookmarks yet"
              copy="Use the bookmark button while reading a chapter."
            />
          )}
        </section>
      </div>
      {reports.length > 0 && (
        <section className="activity-section">
          <div className="section-head">
            <div>
              <span className="eyebrow">SOURCE FEEDBACK</span>
              <h2>Reported issues</h2>
            </div>
            <TriangleAlert />
          </div>
          <div className="compact-list">
            {reports.slice(0, 10).map((report) => (
              <div key={report.id}>
                <TriangleAlert />
                <span>
                  <b>
                    {report.title} · {report.sourceName}
                  </b>
                  <small>
                    {report.detail} · {relativeTime(report.createdAt)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  copy,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
}) {
  return (
    <div className="activity-empty">
      {icon}
      <span>
        <b>{title}</b>
        <small>{copy}</small>
      </span>
    </div>
  );
}
function dayLabel(day: string) {
  if (day === activityDay(new Date().toISOString())) return "Today";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === activityDay(yesterday.toISOString())) return "Yesterday";
  if (day === "Unknown date") return day;
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}
function sourceLabel(
  key: string,
  names: Record<string, string>,
  items: ActivityEntry[],
) {
  const [kind = "source", id = ""] = key.split(":");
  const activityName = items.find((item) => {
    try {
      return (
        new URL(item.href, "https://hao.local").searchParams.get("sourceId") ===
        id
      );
    } catch {
      return false;
    }
  })?.sourceName;
  const type =
    kind === "anime" ? "Anime" : kind === "manga" ? "Manga" : "Source";
  return `${type} · ${names[key] ?? activityName ?? `Source ${id.slice(-6)}`}`;
}
