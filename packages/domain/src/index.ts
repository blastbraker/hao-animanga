import { z } from "zod";

export const MediaKindSchema = z.enum(["ANIME", "MANGA", "MANHWA", "LIGHT_NOVEL"]);
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const LibraryStatusSchema = z.enum([
  "PLANNING",
  "WATCHING_READING",
  "ON_HOLD",
  "COMPLETED",
  "DROPPED",
]);
export type LibraryStatus = z.infer<typeof LibraryStatusSchema>;

export const SourceKindSchema = z.enum([
  "ANILIST",
  "JELLYFIN",
  "DIRECT_MEDIA",
  "MIHON_EXTENSION",
  "ANIYOMI_EXTENSION",
  "MANGAYOMI_EXTENSION",
  "EPUB",
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const WorkSchema = z.object({
  id: z.string().uuid(),
  kind: MediaKindSchema,
  title: z.string().min(1),
  alternateTitles: z.array(z.string()).default([]),
  synopsis: z.string().default(""),
  coverUrl: z.string().url().nullable(),
  bannerUrl: z.string().url().nullable(),
  year: z.number().int().min(1900).max(2200).nullable(),
  status: z.string().nullable(),
  genres: z.array(z.string()).default([]),
  maturityRating: z.string().nullable(),
  averageScore: z.number().min(0).max(100).nullable(),
  source: z.object({ kind: SourceKindSchema, externalId: z.string() }),
});
export type Work = z.infer<typeof WorkSchema>;

export const ProgressSchema = z.object({
  workId: z.string().uuid(),
  releaseItemId: z.string().uuid().nullable(),
  completedUnits: z.number().min(0),
  positionSeconds: z.number().min(0).nullable(),
  positionPercent: z.number().min(0).max(100).nullable(),
  updatedAt: z.string().datetime(),
});
export type Progress = z.infer<typeof ProgressSchema>;

export const LibraryEntrySchema = z.object({
  id: z.string().uuid(),
  work: WorkSchema,
  status: LibraryStatusSchema,
  favorite: z.boolean(),
  rating: z.number().min(0).max(10).nullable(),
  notes: z.string().max(10_000).default(""),
  progress: ProgressSchema.nullable(),
  updatedAt: z.string().datetime(),
});
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;

export const RepositorySchema = z.object({
  id: z.string().uuid(),
  mediaKind: z.enum(["ANIME", "MANGA", "NOVEL"]),
  url: z.string().url().refine((url) => url.startsWith("https://"), "HTTPS is required"),
  name: z.string().min(1),
  acknowledgedAt: z.string().datetime().nullable(),
  enabled: z.boolean(),
  signerFingerprint: z.string().nullable(),
});
export type Repository = z.infer<typeof RepositorySchema>;

export const ApiErrorSchema = z.object({
  code: z.enum(["UNAVAILABLE", "UNAUTHORIZED", "RATE_LIMITED", "INVALID", "NOT_FOUND", "CONFLICT"]),
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string().optional(),
});

export const SearchQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  kind: MediaKindSchema.optional(),
  genre: z.string().optional(),
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  status: z.enum(["RELEASING", "FINISHED", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"]).optional(),
  maturity: z.enum(["GENERAL", "ADULT"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const ImportExtensionWorkSchema = z.object({
  kind: z.enum(["MANGA", "MANHWA"]),
  sourceId: z.string().min(1).max(200),
  externalId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  synopsis: z.string().max(20_000).default(""),
  coverUrl: z.string().url().nullable().default(null),
  status: z.string().max(100).nullable().default(null),
  genres: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
});

export const UpsertLibraryEntrySchema = z.object({
  workId: z.string().uuid(),
  status: LibraryStatusSchema.default("PLANNING"),
  favorite: z.boolean().default(false),
  rating: z.number().min(0).max(10).nullable().default(null),
  notes: z.string().max(10_000).default(""),
});

export const UpdateProgressSchema = z.object({
  workId: z.string().uuid(),
  releaseItemId: z.string().uuid().nullable().default(null),
  completedUnits: z.number().min(0).default(0),
  positionSeconds: z.number().min(0).nullable().default(null),
  positionPercent: z.number().min(0).max(100).nullable().default(null),
});

export function normalizeTitle(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function titleMatchScore(a: Pick<Work, "title" | "alternateTitles" | "kind" | "year">, b: Pick<Work, "title" | "alternateTitles" | "kind" | "year">): number {
  if (a.kind !== b.kind) return 0;
  const left = new Set([a.title, ...a.alternateTitles].map(normalizeTitle));
  const right = new Set([b.title, ...b.alternateTitles].map(normalizeTitle));
  const exact = [...left].some((title) => right.has(title));
  if (!exact) return 0;
  if (a.year && b.year && Math.abs(a.year - b.year) > 1) return 0.65;
  return a.year && b.year ? 0.98 : 0.9;
}

export function progressPercent(completedUnits: number, totalUnits: number | null): number | null {
  if (!totalUnits || totalUnits <= 0) return null;
  return Math.min(100, Math.max(0, (completedUnits / totalUnits) * 100));
}
