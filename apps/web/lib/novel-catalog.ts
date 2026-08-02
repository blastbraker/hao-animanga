export type BlendedNovelItem<TAniList, TSource> =
  { kind: "anilist"; item: TAniList } | { kind: "source"; item: TSource };

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
    anilist.slice(offset, offset + groupSize).forEach((item) => {
      blended.push({ kind: "anilist", item });
    });
    source.slice(offset, offset + groupSize).forEach((item) => {
      blended.push({ kind: "source", item });
    });
  }

  return blended;
}
