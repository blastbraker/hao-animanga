package app.hao.bridge

import io.javalin.Javalin
import io.javalin.json.JavalinJackson
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.time.Instant

object AnimeHostServer {
    fun create(token: String, dataRoot: Path, extensionRoot: Path = dataRoot.resolve("extensions"), fixtureSignerFingerprint: String? = null): Javalin {
        require(token.length >= 32) { "Anime host token is invalid" }
        Files.createDirectories(dataRoot)
        val fixture = FixtureAnimeRuntime()
        val aniyomiProbe = AniyomiApkProbe(extensionRoot, dataRoot)
        val aniyomiFixture = AniyomiFixtureRuntime(extensionRoot, dataRoot, fixtureSignerFingerprint)
        val app = Javalin.create { config ->
            config.jsonMapper(JavalinJackson())
            config.http.defaultContentType = "application/json"
        }
        app.before("/v1/*") { ctx ->
            if (ctx.header("Authorization") != "Bearer $token") {
                ctx.status(401).json(ErrorResponse("UNAUTHORIZED", "Anime host authentication failed"))
                ctx.skipRemainingHandlers()
            }
        }
        app.exception(IllegalArgumentException::class.java) { error, ctx -> ctx.status(400).json(ErrorResponse("INVALID", error.message ?: "Invalid anime host request")) }
        app.exception(Exception::class.java) { error, ctx -> error.printStackTrace(); ctx.status(503).json(ErrorResponse("UNAVAILABLE", "Anime fixture host failed", true)) }
        app.get("/v1/health") { ctx -> ctx.json(HealthResponse("ok", "0.1.0", true)) }
        app.get("/v1/catalog") { ctx -> ctx.json(fixture.catalog() + aniyomiFixture.catalog()) }
        app.get("/v1/extensions/probe") { ctx -> ctx.json(aniyomiProbe.probeInstalled()) }
        app.get("/v1/anime/{animeId}/episodes") { ctx ->
            val id = ctx.pathParam("animeId")
            ctx.json(if (id.startsWith(AniyomiFixtureRuntime.ID_PREFIX)) aniyomiFixture.episodes(id) else fixture.episodes(id))
        }
        app.get("/v1/episodes/{episodeId}/servers") { ctx ->
            val id = ctx.pathParam("episodeId")
            ctx.json(if (id.startsWith(AniyomiFixtureRuntime.ID_PREFIX)) aniyomiFixture.servers(id) else fixture.servers(id))
        }
        app.get("/v1/episodes/{episodeId}/streams") { ctx ->
            val id = ctx.pathParam("episodeId")
            val server = ctx.queryParam("serverId") ?: ""
            ctx.json(if (id.startsWith(AniyomiFixtureRuntime.ID_PREFIX)) aniyomiFixture.streams(id, server) else fixture.streams(id, server))
        }
        app.get("/v1/streams/{streamId}/media") { ctx ->
            appendNetworkEvent(dataRoot, ctx.header("Range"))
            val id = ctx.pathParam("streamId")
            val response = if (id.startsWith(AniyomiFixtureRuntime.ID_PREFIX)) aniyomiFixture.media(id, ctx.header("Range")) else fixture.media(id, ctx.header("Range"))
            ctx.status(response.status).header("Content-Type", response.contentType).header("Accept-Ranges", response.acceptRanges).header("Cache-Control", "private, max-age=3600")
            response.contentLength?.let { ctx.header("Content-Length", it) }
            response.contentRange?.let { ctx.header("Content-Range", it) }
            ctx.result(response.body)
        }
        return app
    }

    @Synchronized private fun appendNetworkEvent(dataRoot: Path, range: String?) {
        val sanitizedRange = range?.takeIf { it.matches(Regex("bytes=[0-9]*-[0-9]*")) } ?: "none"
        Files.writeString(
            dataRoot.resolve("network.log"),
            "${Instant.now()}\tinteractive-examples.mdn.mozilla.net\tRange:$sanitizedRange${System.lineSeparator()}",
            StandardOpenOption.CREATE,
            StandardOpenOption.APPEND,
            StandardOpenOption.WRITE,
        )
    }
}
