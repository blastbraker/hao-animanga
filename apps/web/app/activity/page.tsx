"use client";

import Link from "next/link";
import { Activity, Bell, BookOpen, CheckCircle2, Clock3, Film, Gauge, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ACTIVITY_STORAGE_KEY, parseActivity, parseReaderBookmarks, parseSourceReports, READER_BOOKMARKS_STORAGE_KEY, SOURCE_REPORTS_STORAGE_KEY, type ActivityEntry, type ReaderBookmark, type SourceIssueReport } from "../../lib/beta-features";
import { readSourceReliability, reliabilityScore, type SourceReliabilityMap } from "../../lib/source-reliability";

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [reports, setReports] = useState<SourceIssueReport[]>([]);
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [reliability, setReliability] = useState<SourceReliabilityMap>({});
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unavailable">("unavailable");
  useEffect(() => {
    const refresh = () => {
      setItems(parseActivity(window.localStorage.getItem(ACTIVITY_STORAGE_KEY)));
      setReports(parseSourceReports(window.localStorage.getItem(SOURCE_REPORTS_STORAGE_KEY)));
      setBookmarks(parseReaderBookmarks(window.localStorage.getItem(READER_BOOKMARKS_STORAGE_KEY)));
      setReliability(readSourceReliability());
      setNotificationPermission(typeof Notification === "undefined" ? "unavailable" : Notification.permission);
    };
    refresh(); window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  const sources = useMemo(() => Object.entries(reliability).sort(([, left], [, right]) => reliabilityScore(right) - reliabilityScore(left)), [reliability]);
  async function enableNotifications() { if (typeof Notification !== "undefined") setNotificationPermission(await Notification.requestPermission()); }
  return <div className="page inner-page activity-page">
    <div className="library-heading"><div><span className="eyebrow">YOUR HAO TIMELINE</span><h1>Activity</h1><p>Continue watching and reading, check source health, and review saved bookmarks.</p></div><button className="button ghost" onClick={() => void enableNotifications()} disabled={notificationPermission === "granted" || notificationPermission === "unavailable"}><Bell />{notificationPermission === "granted" ? "Notifications on" : "Enable releases"}</button></div>
    <section className="activity-section"><div className="section-head"><div><span className="eyebrow">RECENTLY OPENED</span><h2>Watch & read history</h2></div><Clock3 /></div>{items.length ? <div className="activity-list">{items.map((item) => <Link href={item.href} key={item.id} className="activity-row"><span className={`activity-icon ${item.kind}`}>{item.kind === "watch" ? <Film /> : <BookOpen />}</span><span><b>{item.title}</b><small>{item.detail} · {item.sourceName}</small></span>{item.progressPercent !== null && <strong>{Math.round(item.progressPercent)}%</strong>}<time>{relativeTime(item.updatedAt)}</time></Link>)}</div> : <Empty icon={<Activity />} title="Your timeline is ready" copy="Start an episode or open a chapter and it will appear here." />}</section>
    <div className="activity-columns">
      <section className="activity-section"><div className="section-head"><div><span className="eyebrow">SMART FAILOVER</span><h2>Source health</h2></div><Gauge /></div>{sources.length ? <div className="health-list">{sources.map(([key, source]) => <div className="source-health" key={key}><span className={source.consecutiveFailures ? "health-dot" : "health-dot good"}/><span><b>{key.replace(":", " · ")}</b><small>{source.successes} successful · {source.failures} failed · {Math.round(source.averageLatencyMs)} ms</small></span><strong>{reliabilityScore(source) >= 30 ? "Healthy" : source.consecutiveFailures ? "Degraded" : "Learning"}</strong></div>)}</div> : <Empty icon={<Gauge />} title="Health checks are learning" copy="HAO ranks sources automatically as you browse and play." />}</section>
      <section className="activity-section"><div className="section-head"><div><span className="eyebrow">SAVED PAGES</span><h2>Reader bookmarks</h2></div><BookOpen /></div>{bookmarks.length ? <div className="compact-list">{bookmarks.slice(0, 8).map((bookmark) => <Link href={bookmark.href} key={bookmark.id}><CheckCircle2/><span><b>{bookmark.title}</b><small>{bookmark.chapterName} · page {bookmark.page}</small></span></Link>)}</div> : <Empty icon={<BookOpen />} title="No bookmarks yet" copy="Use the bookmark button while reading a chapter." />}</section>
    </div>
    {reports.length > 0 && <section className="activity-section"><div className="section-head"><div><span className="eyebrow">SOURCE FEEDBACK</span><h2>Reported issues</h2></div><TriangleAlert /></div><div className="compact-list">{reports.slice(0, 10).map((report) => <div key={report.id}><TriangleAlert/><span><b>{report.title} · {report.sourceName}</b><small>{report.detail} · {relativeTime(report.createdAt)}</small></span></div>)}</div></section>}
  </div>;
}
function Empty({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) { return <div className="activity-empty">{icon}<span><b>{title}</b><small>{copy}</small></span></div>; }
function relativeTime(value: string) { const elapsed = Date.now() - new Date(value).getTime(); if (!Number.isFinite(elapsed) || elapsed < 60_000) return "Just now"; if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`; if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`; return `${Math.floor(elapsed / 86_400_000)}d ago`; }
