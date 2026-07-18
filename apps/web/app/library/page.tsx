"use client";

import { useEffect, useState } from "react";
import type { LibraryEntry } from "@hao/domain";
import { Grid3X3, Library as LibraryIcon, List } from "lucide-react";
import { api, type LibraryResponse } from "../../lib/api";
import { MediaCard } from "../../components/media-card";
import { libraryProgressLabel } from "../../lib/library-progress";

export default function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<LibraryResponse>("/library")
      .then((response) => setEntries(response.items))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const filtered = status === "ALL" ? entries : entries.filter((entry) => entry.status === status);
  return (
    <div className="page inner-page">
      <div className="library-heading">
        <div><span className="eyebrow">YOUR PERMANENT COLLECTION</span><h1>Library</h1><p>{entries.length} titles, safely yours across every source.</p></div>
        <div className="view-toggle"><button className="active" aria-label="Grid view"><Grid3X3 /></button><button aria-label="List view" disabled><List /></button></div>
      </div>
      <div className="tabs">
        {[["ALL", "All"], ["WATCHING_READING", "In progress"], ["PLANNING", "Planning"], ["COMPLETED", "Completed"], ["ON_HOLD", "On hold"]].map(([value, label]) => <button key={value} onClick={() => setStatus(value!)} className={status === value ? "active" : ""}>{label}</button>)}
      </div>
      {loading ? <div className="empty-state">Loading your library…</div> : filtered.length ? (
        <div className="catalog-grid">
          {filtered.map((entry) => <MediaCard key={entry.id} work={entry.work} progress={entry.progress?.positionPercent ?? undefined} progressLabel={libraryProgressLabel(entry)} userRating={entry.rating} />)}
        </div>
      ) : <div className="empty-state"><LibraryIcon size={42} /><h2>This shelf is waiting</h2><p>Start watching or reading and the title will appear here automatically.</p></div>}
    </div>
  );
}
