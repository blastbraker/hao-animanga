import type { LibraryEntry } from "@hao/domain";

export function libraryProgressLabel(entry: LibraryEntry): string | undefined {
  const progress = entry.progress;
  if (!progress) return undefined;
  if (entry.work.kind === "ANIME") {
    const current = (progress.positionPercent ?? 0) >= 95
      ? Math.max(1, Math.floor(progress.completedUnits))
      : Math.max(1, Math.floor(progress.completedUnits) + 1);
    return `Episode ${current} · ${Math.round(progress.positionPercent ?? 0)}%`;
  }
  const unit = Number.isInteger(progress.completedUnits)
    ? String(progress.completedUnits)
    : progress.completedUnits.toFixed(1).replace(/\.0$/, "");
  return `Chapter ${unit}${progress.positionPercent == null ? "" : ` · ${Math.round(progress.positionPercent)}%`}`;
}
