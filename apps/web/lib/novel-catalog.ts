export type BlendedNovelItem<TAniList, TSource> =
  | { kind: "anilist"; item: TAniList; rank: number }
  | { kind: "source"; item: TSource; rank: number };

export function blendNovelRankings<TAniList, TSource>(
  anilist: readonly TAniList[],
  source: readonly TSource[],
  groupSize = 3,
): BlendedNovelItem<TAniList, TSource>[] {
  if (!Number.isInteger(groupSize) || groupSize < 1) {
    throw new Error("Novel ranking group size must be a positive integer");
  }

  const blended: BlendedNovelItem<TAniList, TSource>[] = [];
  const length = Math.max(anilist.length, source.length);

  for (let offset = 0; offset < length; offset += groupSize) {
    anilist.slice(offset, offset + groupSize).forEach((item, index) => {
      blended.push({ kind: "anilist", item, rank: offset + index + 1 });
    });
    source.slice(offset, offset + groupSize).forEach((item, index) => {
      blended.push({ kind: "source", item, rank: offset + index + 1 });
    });
  }

  return blended;
}
