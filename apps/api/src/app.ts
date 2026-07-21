import { randomBytes, randomUUID, createHash } from "node:crypto";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { createDatabase, HaoRepository } from "@hao/database";
import { ImportExtensionWorkSchema, SearchQuerySchema, UpdateProgressSchema, UpsertLibraryEntrySchema } from "@hao/domain";
import type { SearchFilters } from "@hao/providers";
import { AniListProvider } from "./anilist.js";
import { EpisodeGuideProvider } from "./episode-guide.js";
import { authenticate, requireAdmin } from "./auth.js";
import { demoWorks, keyFor, libraryStore, progressStore, workStore } from "./data.js";
import { inspectEpub } from "./epub.js";
import { encryptCredential } from "./crypto.js";
import { testJellyfin, type JellyfinConnection } from "./jellyfin.js";
import { safeProviderFetch, validatePublicHttps } from "./security.js";
import { completePasswordSetup, createPasswordInvitation, generateTemporaryPassword, uploadEpub } from "./supabase.js";

export function buildApp() {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024
  });
  const catalog = new AniListProvider();
  const episodeGuides = new EpisodeGuideProvider();
  const database = createDatabase();
  const repository = database ? new HaoRepository(database) : null;
  app.decorate("haoRepository", repository);
  const audit: Array<Record<string, unknown>> = [];
  const invitations: Array<Record<string, unknown>> = [];
  const jellyfinConnections = new Map<string, JellyfinConnection>();
  const directMedia = new Map<string, Array<{ id: string; name: string; url: string; kind: "HLS" | "MP4" }>>();
  const customLists = new Map<string, Array<{ id: string; name: string; description: string; workIds: string[] }>>();
  const pairingCodes = new Map<string, { userId: string; expiresAt: number }>();
  const bridgeDevices = new Map<
    string,
    Array<{
      id: string;
      name: string;
      endpoint: string;
      lastSeenAt: string;
      revokedAt: null;
    }>
  >();
  const extensionRepositories = new Map<
    string,
    Array<{
      id: string;
      bridgeId: string;
      mediaKind: "ANIME" | "MANGA";
      url: string;
      name: string;
      signerFingerprint: null;
      acknowledgedAt: string;
      enabled: boolean;
    }>
  >();
  let sharedBetaBridgeId: string | null = null;

  const configuredOrigins = process.env.WEB_ORIGIN?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.register(cors, {
    origin: configuredOrigins?.length ? configuredOrigins : process.env.NODE_ENV === "production" ? false : true,
    credentials: true
  });
  app.register(helmet, { contentSecurityPolicy: false });
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

  app.addHook("onClose", async () => {
    if (database) await database.end();
  });
  const health = async () => ({
    status: "ok",
    service: "hao-api",
    database: repository ? await repository.health() : "development-memory",
    time: new Date().toISOString()
  });
  app.get("/health", health);
  app.get("/v1/health", health);
  app.get("/v1/session", { preHandler: authenticate }, async (request) => ({
    user: request.user,
    inviteOnly: true
  }));
  app.post("/v1/auth/password-ready", { preHandler: authenticate }, async (request) => {
    await completePasswordSetup(request.user.id);
    return { ready: true };
  });

  app.get("/v1/discover", async () => {
    if (process.env.NODE_ENV === "test")
      return {
        featured: demoWorks,
        trending: demoWorks.slice().reverse(),
        updated: demoWorks.slice(1),
        source: "fixture"
      };
    const result = await catalog.discover();
    if (!result.ok)
      return {
        featured: demoWorks,
        trending: demoWorks.slice().reverse(),
        updated: demoWorks.slice(1),
        source: "fixture",
        warning: result.error.message
      };
    const materialize = async (items: typeof result.data.trending) => {
      const works = repository ? await Promise.all(items.map((work) => repository.upsertWork(work))) : items;
      works.forEach((work) => workStore.set(work.id, work));
      return works;
    };
    const [featured, trending, updated] = await Promise.all([materialize(result.data.featured), materialize(result.data.trending), materialize(result.data.updated)]);
    return { featured, trending, updated, source: "anilist" };
  });

  app.get("/v1/search", async (request, reply) => {
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({
        code: "INVALID",
        message: parsed.error.issues[0]?.message ?? "Invalid search",
        retryable: false
      });
    const filters: SearchFilters = {
      query: parsed.data.q,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize
    };
    if (parsed.data.kind) filters.kind = parsed.data.kind;
    if (parsed.data.genre) filters.genre = parsed.data.genre;
    if (parsed.data.year) filters.year = parsed.data.year;
    if (parsed.data.status) filters.status = parsed.data.status;
    if (parsed.data.maturity) filters.maturity = parsed.data.maturity;
    const result = await catalog.search(filters);
    if (result.ok) {
      const items = repository ? await Promise.all(result.data.items.map((work) => repository.upsertWork(work))) : result.data.items;
      items.forEach((work) => workStore.set(work.id, work));
      return { ...result.data, items, source: "anilist" };
    }
    const query = parsed.data.q.toLocaleLowerCase();
    const items = demoWorks.filter((work) => (!query || [work.title, ...work.alternateTitles].some((title) => title.toLocaleLowerCase().includes(query))) && (!parsed.data.kind || work.kind === parsed.data.kind));
    return {
      items,
      hasNextPage: false,
      source: "fixture",
      warning: result.error.message
    };
  });

  app.get<{ Params: { id: string } }>("/v1/works/:id", async (request, reply) => {
    const work = (await repository?.getWork(request.params.id)) ?? workStore.get(request.params.id);
    if (!work)
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: "Title not found",
        retryable: false
      });
    return {
      work,
      releases: [],
      sources: [work.source],
      related: demoWorks.filter((item) => item.id !== work.id).slice(0, 3)
    };
  });

  app.get<{ Params: { externalId: string } }>("/v1/works/anilist/:externalId", async (request, reply) => {
    const result = await catalog.getWork(request.params.externalId);
    if (!result.ok) return reply.code(result.error.code === "INVALID" ? 400 : 503).send({ ...result.error });
    const work = repository ? await repository.upsertWork(result.data) : result.data;
    workStore.set(work.id, work);
    return { work, releases: [], sources: [work.source], related: [] };
  });

  app.get<{ Params: { id: string } }>("/v1/works/:id/seasons", async (request, reply) => {
    const work = (await repository?.getWork(request.params.id)) ?? workStore.get(request.params.id);
    if (!work) return reply.code(404).send({ code: "NOT_FOUND", message: "Title not found", retryable: false });
    if (work.kind !== "ANIME" || work.source.kind !== "ANILIST") return { items: [] };
    const result = await catalog.getAnimeSeasons(work.source.externalId);
    if (!result.ok) return reply.code(result.error.code === "INVALID" ? 400 : 503).send({ ...result.error });
    const items = repository ? await Promise.all(result.data.map((item) => repository.upsertWork(item))) : result.data;
    for (const item of items) workStore.set(item.id, item);
    return { items };
  });

  app.get<{ Params: { id: string }; Querystring: { maxEpisode?: string } }>("/v1/works/:id/episode-guide", async (request, reply) => {
    const work = (await repository?.getWork(request.params.id)) ?? workStore.get(request.params.id);
    if (!work) return reply.code(404).send({ code: "NOT_FOUND", message: "Title not found", retryable: false });
    if (work.kind !== "ANIME" || work.source.kind !== "ANILIST") return { items: [], source: "unavailable" };
    const requestedMaximum = Number(request.query.maxEpisode ?? 100);
    const maxEpisode = Number.isFinite(requestedMaximum) ? requestedMaximum : 100;
    const result = await episodeGuides.get(work.source.externalId, maxEpisode);
    if (!result.ok) return reply.code(result.error.code === "INVALID" ? 400 : 503).send({ ...result.error });
    return { items: result.data, source: "myanimelist-via-jikan", cached: result.cached === true };
  });

  app.post("/v1/works/import-extension", { preHandler: authenticate }, async (request, reply) => {
    const parsed = ImportExtensionWorkSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        code: "INVALID",
        message: parsed.error.issues[0]?.message ?? "Invalid extension title",
        retryable: false
      });
    const input = parsed.data;
    const externalId = `${input.sourceId}:${input.externalId}`;
    const digest = createHash("sha256").update(`mihon:${externalId}`).digest("hex").split("");
    digest[12] = "4";
    digest[16] = "8";
    const stableId = `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20, 32).join("")}`;
    const imported = {
      id: stableId,
      kind: input.kind,
      title: input.title,
      alternateTitles: [],
      synopsis: input.synopsis,
      coverUrl: input.coverUrl,
      bannerUrl: null,
      year: null,
      status: input.status,
      genres: input.genres,
      maturityRating: null,
      averageScore: null,
      source: { kind: "MIHON_EXTENSION" as const, externalId }
    };
    const work = repository ? await repository.upsertWork(imported) : imported;
    workStore.set(work.id, work);
    return { work };
  });

  app.get("/v1/library", { preHandler: authenticate }, async (request) => {
    if (repository) return { items: await repository.listLibrary(request.user.id) };
    const entries = [...libraryStore.entries()]
      .filter(([key]) => key.startsWith(`${request.user.id}:`))
      .map(([, entry]) => ({
        ...entry,
        progress: progressStore.get(keyFor(request.user.id, entry.work.id)) ?? null
      }));
    return {
      items: entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    };
  });

  app.put("/v1/library", { preHandler: authenticate }, async (request, reply) => {
    const parsed = UpsertLibraryEntrySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        code: "INVALID",
        message: parsed.error.issues[0]?.message ?? "Invalid library entry",
        retryable: false
      });
    const work = (await repository?.getWork(parsed.data.workId)) ?? workStore.get(parsed.data.workId);
    if (!work)
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: "Title not found",
        retryable: false
      });
    if (repository) return repository.upsertLibrary(request.user.id, parsed.data);
    const now = new Date().toISOString();
    const entry = {
      id: randomUUID(),
      work,
      ...parsed.data,
      progress: progressStore.get(keyFor(request.user.id, work.id)) ?? null,
      updatedAt: now
    };
    libraryStore.set(keyFor(request.user.id, work.id), entry);
    audit.push({
      actorId: request.user.id,
      action: "library.upsert",
      workId: work.id,
      at: now
    });
    return entry;
  });

  app.put("/v1/progress", { preHandler: authenticate }, async (request, reply) => {
    const parsed = UpdateProgressSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        code: "INVALID",
        message: parsed.error.issues[0]?.message ?? "Invalid progress",
        retryable: false
      });
    const progress = repository ? await repository.updateProgress(request.user.id, parsed.data) : { ...parsed.data, updatedAt: new Date().toISOString() };
    progressStore.set(keyFor(request.user.id, parsed.data.workId), progress);
    const libraryKey = keyFor(request.user.id, parsed.data.workId);
    const entry = libraryStore.get(libraryKey);
    if (entry) libraryStore.set(libraryKey, { ...entry, updatedAt: progress.updatedAt });
    return progress;
  });

  app.get("/v1/lists", { preHandler: authenticate }, async (request) => ({ items: repository ? await repository.listCustomLists(request.user.id) : customLists.get(request.user.id) ?? [] }));

  app.post("/v1/lists", { preHandler: authenticate }, async (request, reply) => {
    const name = typeof (request.body as { name?: unknown } | null)?.name === "string" ? String((request.body as { name: string }).name).trim().slice(0, 80) : "";
    if (!name) return reply.code(400).send({ code: "INVALID", message: "A list name is required", retryable: false });
    try {
      const item = repository ? await repository.createCustomList(request.user.id, name) : { id: randomUUID(), name, description: "", workIds: [] as string[] };
      if (!repository) customLists.set(request.user.id, [...(customLists.get(request.user.id) ?? []), item]);
      return reply.code(201).send(item);
    } catch { return reply.code(409).send({ code: "CONFLICT", message: "A list with that name already exists", retryable: false }); }
  });

  app.put<{ Params: { id: string; workId: string } }>("/v1/lists/:id/items/:workId", { preHandler: authenticate }, async (request) => {
    const included = (request.body as { included?: unknown } | null)?.included !== false;
    if (repository) await repository.setCustomListItem(request.user.id, request.params.id, request.params.workId, included);
    else customLists.set(request.user.id, (customLists.get(request.user.id) ?? []).map((list) => list.id === request.params.id ? { ...list, workIds: included ? [...new Set([...list.workIds, request.params.workId])] : list.workIds.filter((id) => id !== request.params.workId) } : list));
    return { saved: true };
  });

  app.post("/v1/source-reports", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const medium = body?.medium;
    const sourceId = typeof body?.sourceId === "string" ? body.sourceId.trim().slice(0, 200) : "";
    const sourceName = typeof body?.sourceName === "string" ? body.sourceName.trim().slice(0, 200) : "";
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 300) : "";
    const detail = typeof body?.detail === "string" ? body.detail.trim().slice(0, 1_000) : "";
    if ((medium !== "anime" && medium !== "manga") || !sourceId || !sourceName || !title || !detail)
      return reply.code(400).send({ code: "INVALID", message: "A complete anime or manga source report is required", retryable: false });
    const metadata = { medium, sourceId, sourceName, title, detail };
    if (repository) await repository.audit(request.user.id, "source.report", "extension_source", sourceId, metadata);
    else audit.unshift({ actorId: request.user.id, action: "source.report", subjectType: "extension_source", subjectId: sourceId, metadata, at: new Date().toISOString() });
    return reply.code(201).send({ saved: true });
  });

  app.post("/v1/feedback", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const category = typeof body?.category === "string" ? body.category.trim().toLowerCase() : "";
    const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2_000) : "";
    const pageUrl = typeof body?.pageUrl === "string" ? body.pageUrl.trim().slice(0, 500) : "";
    if (!new Set(["bug", "idea", "content", "account", "other"]).has(category) || message.length < 5)
      return reply.code(400).send({ code: "INVALID", message: "Choose a feedback type and enter at least five characters", retryable: false });
    const id = randomUUID();
    const metadata = { category, message, pageUrl };
    if (repository) await repository.audit(request.user.id, "feedback.submit", "feedback", id, metadata);
    else audit.unshift({ actorId: request.user.id, action: "feedback.submit", subjectType: "feedback", subjectId: id, metadata, at: new Date().toISOString() });
    return reply.code(201).send({ id, saved: true });
  });

  app.post("/v1/epubs", { preHandler: authenticate }, async (request, reply) => {
    const file = await request.file();
    if (!file || (!file.filename.toLocaleLowerCase().endsWith(".epub") && file.mimetype !== "application/epub+zip"))
      return reply.code(400).send({
        code: "INVALID",
        message: "A valid EPUB file is required",
        retryable: false
      });
    const buffer = await file.toBuffer();
    try {
      const manifest = inspectEpub(buffer);
      const id = randomUUID();
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      if (repository) {
        const title = file.filename.replace(/\.epub$/i, "").trim() || "Uploaded light novel";
        const work = await repository.upsertWork({
          id: randomUUID(),
          kind: "LIGHT_NOVEL",
          title,
          alternateTitles: [],
          synopsis: "",
          coverUrl: null,
          bannerUrl: null,
          year: null,
          status: null,
          genres: [],
          maturityRating: null,
          averageScore: null,
          source: { kind: "EPUB", externalId: sha256 }
        });
        const safeName = file.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
        const storageKey = `${request.user.id}/${id}/${safeName}`;
        await uploadEpub(storageKey, buffer);
        await repository.createEpubAsset({
          id,
          userId: request.user.id,
          workId: work.id,
          storageKey,
          originalName: file.filename,
          byteSize: buffer.length,
          sha256,
          status: "ready",
          manifest
        });
      }
      return reply.code(202).send({
        id,
        filename: file.filename,
        byteSize: buffer.length,
        sha256,
        status: "ready",
        manifest
      });
    } catch (error) {
      return reply.code(400).send({
        code: "INVALID",
        message: error instanceof Error ? error.message : "Unsafe EPUB",
        retryable: false
      });
    }
  });

  app.get("/v1/providers", { preHandler: authenticate }, async (request) => {
    if (repository) return { connections: await repository.listConnections(request.user.id) };
    return {
      jellyfin: jellyfinConnections.get(request.user.id) ? [{ ...jellyfinConnections.get(request.user.id), apiKey: undefined }] : [],
      directMedia: directMedia.get(request.user.id) ?? []
    };
  });

  app.post("/v1/providers/jellyfin", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as {
      endpoint?: unknown;
      apiKey?: unknown;
      name?: unknown;
    };
    if (typeof body.endpoint !== "string" || typeof body.apiKey !== "string" || !body.apiKey)
      return reply.code(400).send({
        code: "INVALID",
        message: "Jellyfin HTTPS endpoint and API key are required",
        retryable: false
      });
    try {
      const system = await testJellyfin(body.endpoint, body.apiKey);
      const connection: JellyfinConnection = {
        id: randomUUID(),
        name: typeof body.name === "string" && body.name ? body.name : system.serverName,
        endpoint: body.endpoint,
        apiKey: body.apiKey,
        ...system
      };
      if (repository) {
        const id = await repository.createConnection(request.user.id, {
          providerType: "JELLYFIN",
          displayName: connection.name,
          endpoint: connection.endpoint,
          encryptedCredentials: encryptCredential({ apiKey: body.apiKey }),
          health: "operational"
        });
        return reply.code(201).send({ ...connection, id, apiKey: undefined });
      }
      jellyfinConnections.set(request.user.id, connection);
      return reply.code(201).send({ ...connection, apiKey: undefined });
    } catch (error) {
      return reply.code(400).send({
        code: "INVALID",
        message: error instanceof Error ? error.message : "Jellyfin connection failed",
        retryable: true
      });
    }
  });

  app.post("/v1/providers/direct-media", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as {
      name?: unknown;
      url?: unknown;
      kind?: unknown;
    };
    if (typeof body.name !== "string" || typeof body.url !== "string" || (body.kind !== "HLS" && body.kind !== "MP4"))
      return reply.code(400).send({
        code: "INVALID",
        message: "Name, HTTPS URL, and HLS/MP4 kind are required",
        retryable: false
      });
    try {
      await validatePublicHttps(body.url);
    } catch (error) {
      return reply.code(400).send({
        code: "INVALID",
        message: error instanceof Error ? error.message : "Unsafe media URL",
        retryable: false
      });
    }
    const kind: "HLS" | "MP4" = body.kind;
    const item = { id: randomUUID(), name: body.name, url: body.url, kind };
    if (repository) {
      const id = await repository.createConnection(request.user.id, {
        providerType: "DIRECT_MEDIA",
        displayName: item.name,
        endpoint: item.url,
        encryptedCredentials: encryptCredential({ kind }),
        health: "operational"
      });
      return reply.code(201).send({ ...item, id });
    }
    directMedia.set(request.user.id, [...(directMedia.get(request.user.id) ?? []), item]);
    return reply.code(201).send(item);
  });

  app.get("/v1/bridges", { preHandler: authenticate }, async (request) => {
    if (repository) return { items: await repository.listBridgeDevices(request.user.id) };
    const personal = (bridgeDevices.get(request.user.id) ?? []).map((device) => ({
      ...device,
      scope: "personal" as const,
      sharedBeta: device.id === sharedBetaBridgeId
    }));
    const shared = sharedBetaBridgeId
      ? [...bridgeDevices.entries()].flatMap(([ownerId, devices]) =>
          ownerId === request.user.id
            ? []
            : devices
                .filter((device) => device.id === sharedBetaBridgeId && !device.revokedAt)
                .map((device) => ({
                  ...device,
                  scope: "beta" as const,
                  sharedBeta: true
                }))
        )
      : [];
    return { items: [...personal, ...shared] };
  });

  app.post("/v1/bridges/pairing-code", { preHandler: authenticate }, async (request) => {
    const code = randomBytes(6).toString("hex").toUpperCase();
    const expiresAt = Date.now() + 10 * 60_000;
    if (repository) await repository.createBridgePairingCode(request.user.id, createHash("sha256").update(code).digest("hex"), new Date(expiresAt));
    else pairingCodes.set(code, { userId: request.user.id, expiresAt });
    return {
      code,
      expiresAt: new Date(expiresAt).toISOString(),
      userId: request.user.id
    };
  });

  app.post("/v1/bridges/complete", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as {
      code?: unknown;
      deviceId?: unknown;
      publicKey?: unknown;
      name?: unknown;
      endpoint?: unknown;
    };
    if (typeof body.code !== "string" || typeof body.deviceId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.deviceId) || typeof body.publicKey !== "string" || body.publicKey.length < 32 || typeof body.name !== "string" || !body.name.trim() || typeof body.endpoint !== "string")
      return reply.code(400).send({
        code: "INVALID",
        message: "Complete Bridge device details are required",
        retryable: false
      });
    let endpoint: string;
    try {
      endpoint = normalizeBridgeEndpoint(body.endpoint);
    } catch (error) {
      return reply.code(400).send({
        code: "INVALID",
        message: error instanceof Error ? error.message : "Invalid Bridge endpoint",
        retryable: false
      });
    }
    if (repository) {
      const consumed = await repository.consumeBridgePairingCode(request.user.id, createHash("sha256").update(body.code).digest("hex"));
      if (!consumed)
        return reply.code(400).send({
          code: "INVALID",
          message: "Pairing code is invalid or expired",
          retryable: false
        });
    } else {
      const pairing = pairingCodes.get(body.code);
      if (!pairing || pairing.userId !== request.user.id || pairing.expiresAt <= Date.now())
        return reply.code(400).send({
          code: "INVALID",
          message: "Pairing code is invalid or expired",
          retryable: false
        });
      pairingCodes.delete(body.code);
    }
    const device = {
      id: body.deviceId,
      name: body.name.trim(),
      endpoint,
      lastSeenAt: new Date().toISOString(),
      revokedAt: null
    };
    if (repository)
      await repository.upsertBridgeDevice(request.user.id, {
        ...device,
        publicKey: body.publicKey
      });
    else bridgeDevices.set(request.user.id, [device, ...(bridgeDevices.get(request.user.id) ?? []).filter((item) => item.id !== device.id)]);
    return reply.code(201).send(device);
  });

  app.get("/v1/repositories", { preHandler: authenticate }, async (request) => {
    if (repository)
      return {
        items: await repository.listExtensionRepositories(request.user.id)
      };
    const personal = (extensionRepositories.get(request.user.id) ?? []).map((item) => ({ ...item, scope: "personal" as const }));
    const shared = sharedBetaBridgeId ? [...extensionRepositories.entries()].flatMap(([ownerId, items]) => (ownerId === request.user.id ? [] : items.filter((item) => item.bridgeId === sharedBetaBridgeId).map((item) => ({ ...item, scope: "beta" as const })))) : [];
    return { items: [...personal, ...shared] };
  });

  app.post("/v1/repositories", { preHandler: authenticate }, async (request, reply) => {
    const body = request.body as {
      bridgeId?: unknown;
      mediaKind?: unknown;
      url?: unknown;
      name?: unknown;
      acknowledged?: unknown;
    };
    if (typeof body.bridgeId !== "string" || (body.mediaKind !== "ANIME" && body.mediaKind !== "MANGA") || typeof body.url !== "string" || typeof body.name !== "string" || !body.name.trim() || body.acknowledged !== true)
      return reply.code(400).send({
        code: "INVALID",
        message: "Bridge, repository, media type, and disclaimer acknowledgement are required",
        retryable: false
      });
    try {
      const url = new URL(body.url);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error("Repository URLs must use HTTPS without embedded credentials");
    } catch (error) {
      return reply.code(400).send({
        code: "INVALID",
        message: error instanceof Error ? error.message : "Invalid repository URL",
        retryable: false
      });
    }
    const now = new Date().toISOString();
    const selectedMediaKind: "ANIME" | "MANGA" = body.mediaKind;
    if (repository) {
      const id = await repository.upsertExtensionRepository(request.user.id, {
        bridgeId: body.bridgeId,
        mediaKind: selectedMediaKind,
        url: body.url,
        name: body.name.trim()
      });
      return reply.code(201).send({
        id,
        bridgeId: body.bridgeId,
        mediaKind: selectedMediaKind,
        url: body.url,
        name: body.name.trim(),
        acknowledgedAt: now,
        enabled: true
      });
    }
    const ownsBridge = (bridgeDevices.get(request.user.id) ?? []).some((device) => device.id === body.bridgeId && !device.revokedAt);
    if (!ownsBridge)
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: "Bridge device not found",
        retryable: false
      });
    const existing = (extensionRepositories.get(request.user.id) ?? []).find((item) => item.bridgeId === body.bridgeId && item.url === body.url);
    const item = {
      id: existing?.id ?? randomUUID(),
      bridgeId: body.bridgeId,
      mediaKind: selectedMediaKind,
      url: body.url,
      name: body.name.trim(),
      signerFingerprint: null,
      acknowledgedAt: now,
      enabled: true
    };
    extensionRepositories.set(request.user.id, [item, ...(extensionRepositories.get(request.user.id) ?? []).filter((entry) => entry.id !== item.id)]);
    return reply.code(201).send(item);
  });

  app.post("/v1/admin/invitations", { preHandler: requireAdmin }, async (request, reply) => {
    const email = (request.body as { email?: unknown })?.email;
    if (typeof email !== "string" || !email.includes("@"))
      return reply.code(400).send({
        code: "INVALID",
        message: "Valid email required",
        retryable: false
      });
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    if (repository) {
      const generated = await createPasswordInvitation(email);
      const invitation = await repository.createInvitation({
        email,
        invitedBy: request.user.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt
      });
      return reply.code(201).send({ ...invitation, temporaryPassword: generated.temporaryPassword });
    }
    const invitation = {
      id: randomUUID(),
      email,
      token,
      expiresAt: expiresAt.toISOString(),
      invitedBy: request.user.id
    };
    invitations.push(invitation);
    return reply.code(201).send({
      ...invitation,
      temporaryPassword: generateTemporaryPassword()
    });
  });
  app.post("/v1/admin/shared-bridge", { preHandler: requireAdmin }, async (request, reply) => {
    const bridgeId = (request.body as { bridgeId?: unknown })?.bridgeId;
    if (bridgeId !== null && typeof bridgeId !== "string")
      return reply.code(400).send({
        code: "INVALID",
        message: "A Bridge selection is required",
        retryable: false
      });
    if (bridgeId) {
      const devices = repository
        ? await repository.listBridgeDevices(request.user.id)
        : (bridgeDevices.get(request.user.id) ?? []).map((device) => ({
            ...device,
            scope: "personal" as const
          }));
      const selected = devices.find((device) => device.id === bridgeId && device.scope === "personal" && !device.revokedAt);
      if (!selected?.endpoint)
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: "Active personal Bridge not found",
          retryable: false
        });
      try {
        await verifySharedBridge(selected.endpoint);
      } catch (error) {
        return reply.code(400).send({
          code: "INVALID",
          message: error instanceof Error ? error.message : "Bridge is not ready for beta sharing",
          retryable: false
        });
      }
    }
    if (repository) await repository.setSharedBetaBridge(request.user.id, bridgeId);
    else sharedBetaBridgeId = bridgeId;
    return { bridgeId, enabled: Boolean(bridgeId) };
  });
  app.get("/v1/admin/overview", { preHandler: requireAdmin }, async (request) => {
    const bridges = repository
      ? await repository.listBridgeDevices(request.user.id)
      : (bridgeDevices.get(request.user.id) ?? []).map((device) => ({
          ...device,
          scope: "personal" as const,
          sharedBeta: device.id === sharedBetaBridgeId
        }));
    return {
      ...(repository
        ? await repository.adminOverview()
        : {
            users: 2,
            activeBridges: bridges.length,
            pendingJobs: 0,
            invitations,
            audit: audit.slice(0, 100)
          }),
      bridges,
      providers: [
        { name: "AniList", health: "operational" },
        { name: "Jellyfin", health: "not configured" }
      ]
    };
  });

  app.setErrorHandler((error, request, reply) => {
    const cause = error as Error & { statusCode?: number };
    request.log.error({ err: cause }, "request failed");
    const status = cause.statusCode && cause.statusCode < 500 ? cause.statusCode : 500;
    void reply.code(status).send({
      code: "UNAVAILABLE",
      message: status < 500 ? cause.message : "Unexpected service error",
      retryable: true,
      requestId: request.id
    });
  });
  return app;
}

function normalizeBridgeEndpoint(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error("Credentials in Bridge URLs are not allowed");
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && loopback)) throw new Error("Bridge endpoints require HTTPS; local development may use HTTP loopback");
  return url.origin;
}

async function verifySharedBridge(endpoint: string): Promise<void> {
  const response = await safeProviderFetch(`${endpoint.replace(/\/$/, "")}/health`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Bridge health check returned ${response.status}`);
  const health = (await response.json()) as {
    status?: unknown;
    paired?: unknown;
    managementProtected?: unknown;
  };
  if (health.status !== "ok" || health.paired !== true) throw new Error("Bridge must be online and paired before beta sharing");
  if (health.managementProtected !== true) throw new Error("Set HAO_BRIDGE_ADMIN_TOKEN on the Bridge before sharing it with beta members");
}
