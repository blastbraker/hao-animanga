package app.hao.bridge

import io.javalin.Javalin
import io.javalin.http.Context
import io.javalin.json.JavalinJackson
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.KeyPairGenerator
import java.util.concurrent.atomic.AtomicReference
import java.nio.file.Path

private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

fun main() {
    val storageRoot = Path.of(System.getenv("HAO_BRIDGE_DATA") ?: Path.of(System.getProperty("user.home"), ".hao", "bridge", "extensions").toString()).toAbsolutePath().normalize()
    val pairingStore = PairingStore(storageRoot.resolveSibling("state"))
    val pairing = AtomicReference(pairingStore.load()?.response())
    val repositories = RepositoryService()
    val extensions = ExtensionManager()
    val suwayomi = SuwayomiClient(
        System.getenv("SUWAYOMI_URL") ?: "http://127.0.0.1:4567/",
        System.getenv("SUWAYOMI_USERNAME"),
        System.getenv("SUWAYOMI_PASSWORD"),
    )
    val suwayomiManager = SuwayomiManager.default(suwayomi)
    val animeHost = AnimeHostManager.default()
    val runtimes = listOf(SuwayomiRuntime(suwayomiManager), AnimeHostExtensionRuntime(animeHost), AniyomiCompatibilityRuntime(animeHost), MangayomiNovelRuntime())
    val port = System.getenv("HAO_BRIDGE_PORT")?.toIntOrNull() ?: 4568
    val adminToken = System.getenv("HAO_BRIDGE_ADMIN_TOKEN")?.trim()?.takeIf { it.isNotEmpty() }
    require(adminToken == null || adminToken.length >= 32) { "HAO_BRIDGE_ADMIN_TOKEN must contain at least 32 characters" }
    val app = Javalin.create { config ->
        config.jsonMapper(JavalinJackson())
        config.http.defaultContentType = "application/json"
        config.bundledPlugins.enableCors { cors -> cors.addRule { rule -> rule.allowHost("http://localhost:3000"); System.getenv("HAO_WEB_ORIGIN")?.let(rule::allowHost) } }
    }
    app.exception(IllegalArgumentException::class.java) { error, ctx -> ctx.status(400).json(ErrorResponse("INVALID", error.message ?: "Invalid request")) }
    app.exception(AnimeHostRequestException::class.java) { error, ctx ->
        val clientError = error.status in 400..499 && error.status != 401
        ctx.status(if (clientError) error.status else 503).json(ErrorResponse(if (clientError) "INVALID" else "UNAVAILABLE", if (clientError) "Anime source request was invalid" else "Isolated anime host is unavailable", !clientError))
    }
    app.exception(Exception::class.java) { error, ctx -> error.printStackTrace(); ctx.status(500).json(ErrorResponse("UNAVAILABLE", "Bridge operation failed", true)) }
    app.get("/health") { ctx -> ctx.json(HealthResponse("ok", "0.1.0", pairing.get() != null, adminToken != null)) }
    app.get("/v1/runtimes") { ctx -> requireManagement(ctx, pairing, adminToken); ctx.json(runtimes.map { it.status() }) }
    app.post("/v1/pair") { ctx ->
        requireAdminToken(ctx, adminToken)
        val body = json.decodeFromString<PairRequest>(ctx.body())
        require(body.code.matches(Regex("[A-F0-9]{8,64}"))) { "Invalid pairing code" }
        val keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val result = pairingStore.save(body, keys).response()
        pairing.set(result); ctx.status(201).contentType("application/json").result(json.encodeToString(result))
    }
    app.post("/v1/repositories/preview") { ctx -> requireManagement(ctx, pairing, adminToken); ctx.contentType("application/json").result(json.encodeToString(repositories.preview(json.decodeFromString<RepositoryRequest>(ctx.body())))) }
    app.get("/v1/extensions") { ctx -> requireManagement(ctx, pairing, adminToken); ctx.contentType("application/json").result(json.encodeToString(extensions.listInstalled(storageRoot))) }
    app.post("/v1/extensions/inspect") { ctx -> requireManagement(ctx, pairing, adminToken); ctx.contentType("application/json").result(json.encodeToString(extensions.inspect(json.decodeFromString<InspectExtensionRequest>(ctx.body()), storageRoot))) }
    app.post("/v1/extensions/install") { ctx ->
        requireManagement(ctx, pairing, adminToken)
        val installed = extensions.install(json.decodeFromString<ConfirmInstallRequest>(ctx.body()), storageRoot)
        if (installed.mediaKind == MediaKind.MANGA) suwayomiManager.sync(extensions.listInstalled(storageRoot))
        if (installed.mediaKind == MediaKind.ANIME) animeHost.close()
        ctx.status(201).contentType("application/json").result(json.encodeToString(installed))
    }
    app.post("/v1/extensions/state") { ctx ->
        requireManagement(ctx, pairing, adminToken)
        val updated = extensions.setEnabled(json.decodeFromString<ExtensionStateRequest>(ctx.body()), storageRoot)
        if (updated.mediaKind == MediaKind.MANGA) suwayomiManager.sync(extensions.listInstalled(storageRoot))
        if (updated.mediaKind == MediaKind.ANIME) animeHost.close()
        ctx.contentType("application/json").result(json.encodeToString(updated))
    }
    app.post("/v1/extensions/remove") { ctx ->
        requireManagement(ctx, pairing, adminToken)
        val request = json.decodeFromString<RemoveExtensionRequest>(ctx.body())
        if (request.mediaKind == MediaKind.MANGA) suwayomiManager.uninstall(request.packageName)
        val removed = extensions.remove(request, storageRoot)
        if (request.mediaKind == MediaKind.ANIME) animeHost.close()
        ctx.contentType("application/json").result(json.encodeToString(removed))
    }
    System.getenv("HAO_DEV_FIXTURE_APK")?.let { fixturePath ->
        app.post("/v1/dev/fixtures/aniyomi/install") { ctx ->
            requireManagement(ctx, pairing, adminToken)
            val installed = extensions.installLocalFixture(Path.of(fixturePath), storageRoot)
            animeHost.close()
            ctx.status(201).contentType("application/json").result(json.encodeToString(installed))
        }
    }
    app.get("/v1/manga/runtime") { ctx -> requireManagement(ctx, pairing, adminToken); ctx.json(suwayomiManager.status()) }
    app.post("/v1/manga/runtime/start") { ctx -> requireManagement(ctx, pairing, adminToken); ctx.json(suwayomiManager.ensureStarted()) }
    app.post("/v1/manga/runtime/sync") { ctx -> requireManagement(ctx, pairing, adminToken); ctx.json(suwayomiManager.sync(extensions.listInstalled(storageRoot))) }
    app.get("/v1/anime/sources") { ctx -> requirePaired(ctx, pairing); ctx.json(animeHost.sources()) }
    app.get("/v1/anime/catalog") { ctx ->
        requirePaired(ctx, pairing)
        ctx.json(
            animeHost.catalog(
                ctx.queryParam("sourceId"),
                ctx.queryParam("mode") ?: "popular",
                ctx.queryParam("query"),
                ctx.queryParam("page")?.toIntOrNull() ?: 1,
            ),
        )
    }
    app.get("/v1/anime/extensions/probe") { ctx -> requireManagement(ctx, pairing, adminToken); ctx.json(animeHost.probes()) }
    app.get("/v1/anime/{animeId}/episodes") { ctx -> requirePaired(ctx, pairing); ctx.json(animeHost.episodes(ctx.pathParam("animeId"))) }
    app.get("/v1/anime/{animeId}/thumbnail") { ctx ->
        requirePaired(ctx, pairing)
        val response = animeHost.thumbnail(ctx.pathParam("animeId"))
        ctx.contentType(response.contentType).header("Cache-Control", "private, max-age=86400").result(response.body)
    }
    app.get("/v1/anime/episodes/{episodeId}/servers") { ctx -> requirePaired(ctx, pairing); ctx.json(animeHost.servers(ctx.pathParam("episodeId"))) }
    app.get("/v1/anime/episodes/{episodeId}/streams") { ctx -> requirePaired(ctx, pairing); ctx.json(animeHost.streams(ctx.pathParam("episodeId"), ctx.queryParam("serverId") ?: "")) }
    app.get("/v1/anime/streams/{streamId}/media") { ctx ->
        requirePaired(ctx, pairing)
        val response = animeHost.media(ctx.pathParam("streamId"), ctx.header("Range"))
        ctx.status(response.status).header("Content-Type", response.contentType).header("Accept-Ranges", response.acceptRanges).header("Cache-Control", "private, max-age=3600")
        response.contentLength?.let { ctx.header("Content-Length", it) }
        response.contentRange?.let { ctx.header("Content-Range", it) }
        ctx.result(response.body)
    }
    app.get("/v1/anime/streams/{streamId}/subtitles") { ctx ->
        requirePaired(ctx, pairing)
        val response = animeHost.subtitle(ctx.pathParam("streamId"))
        ctx.status(response.status).header("Content-Type", response.contentType).header("Cache-Control", "private, max-age=3600")
        response.contentLength?.let { ctx.header("Content-Length", it) }
        ctx.result(response.body)
    }
    app.get("/v1/manga/sources") { ctx -> requirePaired(ctx, pairing); ctx.json(suwayomi.sources()) }
    app.get("/v1/manga/search") { ctx ->
        requirePaired(ctx, pairing)
        ctx.json(suwayomi.search(ctx.queryParam("sourceId") ?: "", ctx.queryParam("query") ?: "", ctx.queryParam("page")?.toIntOrNull() ?: 1))
    }
    app.get("/v1/manga/browse") { ctx ->
        requirePaired(ctx, pairing)
        ctx.json(suwayomi.browse(ctx.queryParam("sourceId") ?: "", ctx.queryParam("mode") ?: "popular", ctx.queryParam("page")?.toIntOrNull() ?: 1))
    }
    app.get("/v1/manga/{mangaId}") { ctx -> requirePaired(ctx, pairing); ctx.json(suwayomi.manga(ctx.pathParam("mangaId").toInt())) }
    app.get("/v1/manga/{mangaId}/chapters") { ctx -> requirePaired(ctx, pairing); ctx.json(suwayomi.chapters(ctx.pathParam("mangaId").toInt())) }
    app.get("/v1/manga/{mangaId}/chapter/{chapterIndex}/pages") { ctx -> requirePaired(ctx, pairing); ctx.json(suwayomi.pages(ctx.pathParam("mangaId").toInt(), ctx.pathParam("chapterIndex").toInt())) }
    app.get("/v1/manga/{mangaId}/thumbnail") { ctx ->
        requirePaired(ctx, pairing)
        val response = suwayomi.thumbnail(ctx.pathParam("mangaId").toInt())
        ctx.contentType(response.contentType).header("Cache-Control", "private, max-age=3600").result(response.body)
    }
    app.get("/v1/manga/{mangaId}/chapter/{chapterIndex}/page/{pageIndex}") { ctx ->
        requirePaired(ctx, pairing)
        val response = suwayomi.page(ctx.pathParam("mangaId").toInt(), ctx.pathParam("chapterIndex").toInt(), ctx.pathParam("pageIndex").toInt())
        ctx.contentType(response.contentType).header("Cache-Control", "private, max-age=86400").result(response.body)
    }
    app.start("127.0.0.1", port)
    Thread.ofVirtual().name("hao-suwayomi-startup").start {
        runCatching {
            suwayomiManager.ensureStarted()
            suwayomiManager.sync(extensions.listInstalled(storageRoot))
        }.onFailure { it.printStackTrace() }
    }
    Thread.ofVirtual().name("hao-anime-host-startup").start { runCatching { animeHost.ensureStarted() }.onFailure { it.printStackTrace() } }
    Runtime.getRuntime().addShutdownHook(Thread { animeHost.close() })
}

private fun requirePaired(ctx: Context, pairing: AtomicReference<PairResponse?>) { require(pairing.get() != null) { "Bridge must be paired first" } }

private fun requireAdminToken(ctx: Context, configuredToken: String?) {
    if (configuredToken == null) return
    require(Security.secretsMatch(configuredToken, ctx.header("X-HAO-Bridge-Admin"))) { "Bridge administrator access required" }
}

private fun requireManagement(ctx: Context, pairing: AtomicReference<PairResponse?>, configuredToken: String?) {
    requirePaired(ctx, pairing)
    requireAdminToken(ctx, configuredToken)
}
