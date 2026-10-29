"use client";
import Link from "next/link";
import { BookOpen, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type LibraryResponse } from "../lib/api";
import {
  ACTIVITY_STORAGE_KEY,
  parseActivity,
  type ActivityEntry,
} from "../lib/beta-features";

export function ReadingResumeShelf() {
  const [items, setItems] = useState<
    Array<ActivityEntry & { cover?: string | null }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    let history: ActivityEntry[] = [];
    try {
      history = parseActivity(localStorage.getItem(ACTIVITY_STORAGE_KEY))
        .filter(
          (item) => item.kind === "read" && item.href.startsWith("/reader?"),
        )
        .slice(0, 3);
    } catch {
      /* Storage may be disabled. */
    }
    setItems(history);
    if (history.length)
      void api<LibraryResponse>("/library")
        .then(({ items: library }) => {
          if (!cancelled)
            setItems(
              history.map((item) => ({
                ...item,
                cover:
                  library.find((entry) => entry.work.title === item.title)?.work
                    .coverUrl ?? null,
              })),
            );
        })
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!items.length) return null;
  return (
    <section className="browse-resume-section" aria-label="Continue reading">
      <div className="section-head">
        <h2>Continue reading</h2>
        <Link href="/library">
          My library <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="browse-resume-row">
        {items.map((item) => (
          <Link className="browse-resume-card" href={item.href} key={item.id}>
            {item.cover ? (
              <img src={item.cover} alt="" />
            ) : (
              <span className="resume-placeholder">
                <BookOpen />
              </span>
            )}
            <div>
              <b>{item.title}</b>
              <small>{item.detail}</small>
              {item.progressPercent != null && (
                <span className="browse-progress">
                  <i
                    style={{
                      width: `${Math.min(100, Math.max(0, item.progressPercent))}%`,
                    }}
                  />
                </span>
              )}
            </div>
            <span className="resume-action">
              Read <ArrowUpRight size={14} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
