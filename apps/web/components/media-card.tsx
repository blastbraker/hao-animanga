import Link from "next/link";
import type { Work } from "@hao/domain";
import { Play, Star } from "lucide-react";

export function MediaCard({ work, progress }: { work: Work; progress?: number | undefined }) {
  return <Link href={`/title/${work.id}`} className="media-card">
    <div className="poster"><img src={work.coverUrl ?? "/icon.svg"} alt="" loading="lazy"/><span className={`type-chip ${work.kind.toLowerCase()}`}>{work.kind.replace("_", " ")}</span><span className="play-hover"><Play fill="currentColor"/></span>{progress !== undefined && <span className="progress-line" style={{ width: `${progress}%` }}/>}</div>
    <div className="card-copy"><h3>{work.title}</h3><p>{work.year ?? "—"} · {work.genres[0] ?? "Uncategorized"}</p>{work.averageScore && <span className="score"><Star size={13} fill="currentColor"/> {(work.averageScore / 10).toFixed(1)}</span>}</div>
  </Link>;
}
