import { randomBytes, randomUUID, createHash } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { createDatabase, HaoRepository } from "@hao/database";
import { SearchQuerySchema, UpdateProgressSchema, UpsertLibraryEntrySchema } from "@hao/domain";
import type { SearchFilters } from "@hao/providers";
import { AniListProvider } from "./anilist.js";
import { authenticate, requireAdmin } from "./auth.js";
import { demoWorks, keyFor, libraryStore, progressStore, workStore } from "./data.js";
import { inspectEpub } from "./epub.js";
import { encryptCredential } from "./crypto.js";
import { testJellyfin, type JellyfinConnection } from "./jellyfin.js";
import { validatePublicHttps } from "./security.js";
import { inviteUser, uploadEpub } from "./supabase.js";

export function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  const catalog = new AniListProvider();
  const database = createDatabase();
  const repository = database ? new HaoRepository(database) : null;
  app.decorate("haoRepository", repository);
  const audit: Array<Record<string, unknown>> = [];
  const invitations: Array<Record<string, unknown>> = [];
  const jellyfinConnections = new Map<string, JellyfinConnection>();
  const directMedia = new Map<string, Array<{ id: string; name: string; url: string; kind: "HLS" | "MP4" }>>();

  app.register(cors, { origin: process.env.WEB_ORIGIN?.split(",") ?? true, credentials: true });
  app.register(helmet, { contentSecurityPolicy: false });
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

  app.addHook("onClose", async () => { if (database) await database.end(); });
  app.get("/health", async () => ({ status: "ok", service: "hao-api", database: repository ? await repository.health() : "development-memory", time: new Date().toISOString() }));
  app.get("/v1/session", { preHandler: authenticate }, async (request) => ({ user: request.user, inviteOnly: true }));

  app.get("/v1/discover", async () => ({
    featured: demoWorks,
    trending: demoWorks.slice().reverse(),
    updated: demoWorks.slice(1),
  }));

  app.get("/v1/search", async (request, reply) => {
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID", message: parsed.error.issues[0]?.message ?? "Invalid search", retryable: false });
    const filters: SearchFilters = { query: parsed.data.q, page: parsed.data.page, pageSize: parsed.data.pageSize };
    if (parsed.data.kind) filters.kind = parsed.data.kind;
    if (parsed.data.genre) filters.genre = parsed.data.genre;
    if (parsed.data.year) filters.year = parsed.data.year;
    const result = await catalog.search(filters);
    if (result.ok) {
      const items = repository
        ? await Promise.all(result.data.items.map((work) => repository.upsertWork(work)))
        : result.data.items;
      items.forEach((work) => workStore.set(work.id, work));
      return { ...result.data, items, source: "anilist" };
    }
    const query = parsed.data.q.toLocaleLowerCase();
    const items = demoWorks.filter((work) => (!query || [work.title, ...work.alternateTitles].some((title) => title.toLocaleLowerCase().includes(query))) && (!parsed.data.kind || work.kind === parsed.data.kind));
    return { items, hasNextPage: false, source: "fixture", warning: result.error.message };
  });

  app.get<{ Params: { id: string } }>("/v1/works/:id", async (request, reply) => {
    const work = await repository?.getWork(request.params.id) ?? workStore.get(request.params.id);
    if (!work) return reply.code(404).send({ code: "NOT_FOUND", message: "Title not found", retryable: false });
    return { work, releases: [], sources: [work.source], related: demoWorks.filter((item) => item.id !== work.id).slice(0, 3) };
  });

  app.get("/v1/library", { preHandler: authenticate }, async (request) => {
    if (repository) return { items: await repository.listLibrary(request.user.id) };
    const entries = [...libraryStore.entries()].filter(([key]) => key.startsWith(`${request.user.id}:`)).map(([, entry]) => ({ ...entry, progress: progressStore.get(keyFor(request.user.id, entry.work.id)) ?? null }));
    return { items: entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  });

  app.put("/v1/library", { preHandler: authenticate }, async (request, reply) => {
    const parsed = UpsertLibraryEntrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID", message: parsed.error.issues[0]?.message ?? "Invalid library entry", retryable: false });
    const work = await repository?.getWork(parsed.data.workId) ?? workStore.get(parsed.data.workId);
    if (!work) return reply.code(404).send({ code: "NOT_FOUND", message: "Title not found", retryable: false });
    if (repository) return repository.upsertLibrary(request.user.id, parsed.data);
    const now = new Date().toISOString();
    const entry = { id: randomUUID(), work, ...parsed.data, progress: progressStore.get(keyFor(request.user.id, work.id)) ?? null, updatedAt: now };
    libraryStore.set(keyFor(request.user.id, work.id), entry);
    audit.push({ actorId: request.user.id, action: "library.upsert", workId: work.id, at: now });
    return entry;
  });

  app.put("/v1/progress", { preHandler: authenticate }, async (request, reply) => {
    const parsed = UpdateProgressSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "INVALID", message: parsed.error.issues[0]?.message ?? "Invalid progress", retryable: false });
    const progress = repository ? await repository.updateProgress(request.user.id, parsed.data) : { ...parsed.data, updatedAt: new Date().toISOString() };
    progressStore.set(keyFor(request.user.id, parsed.data.workId), progress);
    return progress;
  });

  app.post("/v1/epubs", { preHandler: authenticate }, async (request, reply) => {
    const file = await request.file();
    if (!file || (!file.filename.toLocaleLowerCase().endsWith(".epub") && file.mimetype !== "application/epub+zip")) return reply.code(400).send({ code: "INVALID", message: "A valid EPUB file is required", retryable: false });
    const buffer = await file.toBuffer();
    try {
      const manifest = inspectEpub(buffer);
      const id = randomUUID();
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      if (repository) {
        const title = file.filename.replace(/\.epub$/i, "").trim() || "Uploaded light novel";
        const work = await repository.upsertWork({ id: randomUUID(), kind: "LIGHT_NOVEL", title, alternateTitles: [], synopsis: "", coverUrl: null, bannerUrl: null, year: null, status: null, genres: [], maturityRating: null, averageScore: null, source: { kind: "EPUB", externalId: sha256 } });
        const safeName = file.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const storageKey = `${request.user.id}/${id}/${safeName}`;
        await uploadEpub(storageKey, buffer);
        await repository.createEpubAsset({ id, userId: request.user.id, workId: work.id, storageKey, originalName: file.filename, byteSize: buffer.length, sha256, status: "ready", manifest });
      }
      return reply.code(202).send({ id, filename: file.filename, byteSize: buffer.length, sha256, status: "ready", manifest });
    } catch (error) {
      return reply.code(400).send({ code: "INVALID", message: error instanceof Error ? error.message : "Unsafe EPUB", retryable: false });
    }
  });

  app.get("/v1/providers", { preHandler: authenticate }, async (request) => {
    if (repository) return { connections: await repository.listConnections(request.user.id) };
    return { jellyfin: jellyfinConnections.get(request.user.id) ? [{ ...jellyfinConnections.get(request.user.id), apiKey: undefined }] : [], directMedia: directMedia.get(request.user.id) ?? [] };
  });

  app.post("/v1/providers/jellyfin", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as { endpoint?: unknown; apiKey?: unknown; name?: unknown };
    if (typeof body.endpoint !== "string" || typeof body.apiKey !== "string" || !body.apiKey) return reply.code(400).send({ code: "INVALID", message: "Jellyfin HTTPS endpoint and API key are required", retryable: false });
    try {
      const system = await testJellyfin(body.endpoint, body.apiKey);
      const connection: JellyfinConnection = { id: randomUUID(), name: typeof body.name === "string" && body.name ? body.name : system.serverName, endpoint: body.endpoint, apiKey: body.apiKey, ...system };
      if (repository) {
        const id = await repository.createConnection(request.user.id, { providerType: "JELLYFIN", displayName: connection.name, endpoint: connection.endpoint, encryptedCredentials: encryptCredential({ apiKey: body.apiKey }), health: "operational" });
        return reply.code(201).send({ ...connection, id, apiKey: undefined });
      }
      jellyfinConnections.set(request.user.id, connection);
      return reply.code(201).send({ ...connection, apiKey: undefined });
    } catch (error) {
      return reply.code(400).send({ code: "INVALID", message: error instanceof Error ? error.message : "Jellyfin connection failed", retryable: true });
    }
  });

  app.post("/v1/providers/direct-media", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as { name?: unknown; url?: unknown; kind?: unknown };
    if (typeof body.name !== "string" || typeof body.url !== "string" || (body.kind !== "HLS" && body.kind !== "MP4")) return reply.code(400).send({ code: "INVALID", message: "Name, HTTPS URL, and HLS/MP4 kind are required", retryable: false });
    try { await validatePublicHttps(body.url); } catch (error) { return reply.code(400).send({ code: "INVALID", message: error instanceof Error ? error.message : "Unsafe media URL", retryable: false }); }
    const kind: "HLS" | "MP4" = body.kind;
    const item = { id: randomUUID(), name: body.name, url: body.url, kind };
    if (repository) {
      const id = await repository.createConnection(request.user.id, { providerType: "DIRECT_MEDIA", displayName: item.name, endpoint: item.url, encryptedCredentials: encryptCredential({ kind }), health: "operational" });
      return reply.code(201).send({ ...item, id });
    }
    directMedia.set(request.user.id, [...(directMedia.get(request.user.id) ?? []), item]);
    return reply.code(201).send(item);
  });

  app.post("/v1/bridges/pairing-code", { preHandler: authenticate }, async (request) => ({ code: randomBytes(4).toString("hex").toUpperCase(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), userId: request.user.id }));

  app.post("/v1/admin/invitations", { preHandler: requireAdmin }, async (request, reply) => {
    const email = (request.body as { email?: unknown })?.email;
    if (typeof email !== "string" || !email.includes("@")) return reply.code(400).send({ code: "INVALID", message: "Valid email required", retryable: false });
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    if (repository) {
      await inviteUser(email);
      const invitation = await repository.createInvitation({ email, invitedBy: request.user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt });
      return reply.code(201).send(invitation);
    }
    const invitation = { id: randomUUID(), email, token, expiresAt: expiresAt.toISOString(), invitedBy: request.user.id };
    invitations.push(invitation);
    return reply.code(201).send(invitation);
  });
  app.get("/v1/admin/overview", { preHandler: requireAdmin }, async () => ({ ...(repository ? await repository.adminOverview() : { users: 2, activeBridges: 0, pendingJobs: 0, invitations, audit: audit.slice(-20).reverse() }), providers: [{ name: "AniList", health: "operational" }, { name: "Jellyfin", health: "not configured" }] }));

  app.setErrorHandler((error, request, reply) => {
    const cause = error as Error & { statusCode?: number };
    request.log.error({ err: cause }, "request failed");
    const status = cause.statusCode && cause.statusCode < 500 ? cause.statusCode : 500;
    void reply.code(status).send({ code: "UNAVAILABLE", message: status < 500 ? cause.message : "Unexpected service error", retryable: true, requestId: request.id });
  });
  return app;
}
