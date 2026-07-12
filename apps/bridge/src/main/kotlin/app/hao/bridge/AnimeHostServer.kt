package app.hao.bridge

import io.javalin.Javalin
import io.javalin.json.JavalinJackson
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.time.Instant

object AnimeHostServer {
    fun create(token: String, dataRoot: Path, extensionRoot: Path = dataRoot.resolve("extensions")): Javalin {
        require(token.length >= 32) { "Anime host token is invalid" }
        Files.createDirectories(dataRoot)
        val fixture = FixtureAnimeRuntime()
        val aniyomiProbe = AniyomiApkProbe(extensionRoot, dataRoot)
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
        app.get("/v1/catalog") { ctx -> ctx.json(fixture.catalog()) }
        app.get("/v1/extensions/probe") { ctx -> ctx.json(aniyomiProbe.probeInstalled()) }
        app.get("/v1/anime/{animeId}/episodes") { ctx -> ctx.json(fixture.episodes(ctx.pathParam("animeId"))) }
        app.get("/v1/episodes/{episodeId}/servers") { ctx -> ctx.json(fixture.servers(ctx.pathParam("episodeId"))) }
        app.get("/v1/episodes/{episodeId}/streams") { ctx -> ctx.json(fixture.streams(ctx.pathParam("episodeId"), ctx.queryParam("serverId") ?: "")) }
        app.get("/v1/streams/{streamId}/media") { ctx ->
            appendNetworkEvent(dataRoot, ctx.header("Range"))
            val response = fixture.media(ctx.pathParam("streamId"), ctx.header("Range"))
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
