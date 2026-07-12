package app.hao.bridge

import io.javalin.Javalin
import io.javalin.http.Context
import io.javalin.json.JavalinJackson
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.KeyPairGenerator
import java.time.Instant
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import java.nio.file.Path

private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

fun main() {
    val pairing = AtomicReference<PairResponse?>(null)
    val repositories = RepositoryService()
    val extensions = ExtensionManager()
    val suwayomi = SuwayomiClient(
        System.getenv("SUWAYOMI_URL") ?: "http://127.0.0.1:4567/",
        System.getenv("SUWAYOMI_USERNAME"),
        System.getenv("SUWAYOMI_PASSWORD"),
    )
    val runtimes = listOf(SuwayomiRuntime(suwayomi), AniyomiCompatibilityRuntime())
    val storageRoot = Path.of(System.getenv("HAO_BRIDGE_DATA") ?: Path.of(System.getProperty("user.home"), ".hao", "bridge", "extensions").toString()).toAbsolutePath().normalize()
    val port = System.getenv("HAO_BRIDGE_PORT")?.toIntOrNull() ?: 4568
    val app = Javalin.create { config ->
        config.jsonMapper(JavalinJackson())
        config.http.defaultContentType = "application/json"
        config.bundledPlugins.enableCors { cors -> cors.addRule { rule -> rule.allowHost("http://localhost:3000"); System.getenv("HAO_WEB_ORIGIN")?.let(rule::allowHost) } }
    }
    app.exception(IllegalArgumentException::class.java) { error, ctx -> ctx.status(400).json(ErrorResponse("INVALID", error.message ?: "Invalid request")) }
    app.exception(Exception::class.java) { error, ctx -> error.printStackTrace(); ctx.status(500).json(ErrorResponse("UNAVAILABLE", "Bridge operation failed", true)) }
    app.get("/health") { ctx -> ctx.json(HealthResponse("ok", "0.1.0", pairing.get() != null)) }
    app.get("/v1/runtimes") { ctx -> ctx.json(runtimes.map { it.status() }) }
    app.post("/v1/pair") { ctx ->
        val body = json.decodeFromString<PairRequest>(ctx.body())
        require(body.code.matches(Regex("[A-F0-9]{8}"))) { "Invalid pairing code" }
        val keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val result = PairResponse(UUID.randomUUID().toString(), java.util.Base64.getEncoder().encodeToString(keys.public.encoded), Instant.now().toString())
        pairing.set(result); ctx.status(201).contentType("application/json").result(json.encodeToString(result))
    }
    app.post("/v1/repositories/preview") { ctx -> requirePaired(ctx, pairing); ctx.contentType("application/json").result(json.encodeToString(repositories.preview(json.decodeFromString<RepositoryRequest>(ctx.body())))) }
    app.get("/v1/extensions") { ctx -> requirePaired(ctx, pairing); ctx.contentType("application/json").result(json.encodeToString(extensions.listInstalled(storageRoot))) }
    app.post("/v1/extensions/inspect") { ctx -> requirePaired(ctx, pairing); ctx.contentType("application/json").result(json.encodeToString(extensions.inspect(json.decodeFromString<InspectExtensionRequest>(ctx.body()), storageRoot))) }
    app.post("/v1/extensions/install") { ctx -> requirePaired(ctx, pairing); ctx.status(201).contentType("application/json").result(json.encodeToString(extensions.install(json.decodeFromString<ConfirmInstallRequest>(ctx.body()), storageRoot))) }
    app.post("/v1/extensions/state") { ctx -> requirePaired(ctx, pairing); ctx.contentType("application/json").result(json.encodeToString(extensions.setEnabled(json.decodeFromString<ExtensionStateRequest>(ctx.body()), storageRoot))) }
    app.post("/v1/extensions/remove") { ctx -> requirePaired(ctx, pairing); ctx.contentType("application/json").result(json.encodeToString(extensions.remove(json.decodeFromString<RemoveExtensionRequest>(ctx.body()), storageRoot))) }
    app.get("/v1/manga/sources") { ctx -> requirePaired(ctx, pairing); ctx.json(suwayomi.sources()) }
    app.get("/v1/manga/search") { ctx ->
        requirePaired(ctx, pairing)
        ctx.json(suwayomi.search(ctx.queryParam("sourceId") ?: "", ctx.queryParam("query") ?: "", ctx.queryParam("page")?.toIntOrNull() ?: 1))
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
}

private fun requirePaired(ctx: Context, pairing: AtomicReference<PairResponse?>) { require(pairing.get() != null) { "Bridge must be paired first" } }
