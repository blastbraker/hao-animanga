import Link from "next/link";
import type { Work } from "@hao/domain";
import { Play, Star } from "lucide-react";

export function MediaCard({ work, progress, progressLabel, userRating }: { work: Work; progress?: number | undefined; progressLabel?: string | undefined; userRating?: number | null | undefined }) {
  const href = work.source.kind === "ANILIST" ? `/title/${work.id}?anilistId=${encodeURIComponent(work.source.externalId)}` : `/title/${work.id}`;
  return <Link href={href} className="media-card">
    <div className="poster"><img src={work.coverUrl ?? "/icon.svg"} alt="" loading="lazy"/><span className={`type-chip ${work.kind.toLowerCase()}`}>{work.kind.replace("_", " ")}</span><span className="play-hover"><Play fill="currentColor"/></span>{progress !== undefined && <span className="progress-line" style={{ width: `${progress}%` }}/>}</div>
    <div className="card-copy"><h3>{work.title}</h3><p>{progressLabel ?? `${work.year ?? "—"} · ${work.genres[0] ?? "Uncategorized"}`}</p>{userRating != null ? <span className="score user-score"><Star size={13} fill="currentColor"/> {userRating.toFixed(1)}</span> : work.averageScore ? <span className="score"><Star size={13} fill="currentColor"/> {(work.averageScore / 10).toFixed(1)}</span> : null}</div>
  </Link>;
}
