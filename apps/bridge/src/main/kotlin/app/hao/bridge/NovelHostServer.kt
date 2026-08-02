package app.hao.bridge

import io.javalin.Javalin
import io.javalin.json.JavalinJackson
import java.nio.file.Files
import java.nio.file.Path

object NovelHostServer {
    fun create(token: String, dataRoot: Path, extensionRoot: Path): Javalin {
        require(token.length >= 32) { "Novel host token is invalid" }
        Files.createDirectories(dataRoot)
        val runtime = NovelScriptRuntime(extensionRoot, dataRoot, token)
        val app = Javalin.create { config ->
            config.jsonMapper(JavalinJackson())
            config.http.defaultContentType = "application/json"
        }
        app.before("/v1/*") { ctx ->
            if (ctx.header("Authorization") != "Bearer $token") {
                ctx.status(401).json(ErrorResponse("UNAUTHORIZED", "Novel host authentication failed"))
                ctx.skipRemainingHandlers()
            }
        }
        app.exception(IllegalArgumentException::class.java) { error, ctx ->
            System.err.println("Novel host rejected a request: ${error.message ?: error.javaClass.simpleName}")
            ctx.status(400).json(ErrorResponse("INVALID", error.message ?: "Invalid novel source request"))
        }
        app.exception(Exception::class.java) { error, ctx ->
            error.printStackTrace()
            ctx.status(503).json(ErrorResponse("UNAVAILABLE", "Novel extension failed", true))
        }
        app.get("/v1/health") { ctx -> ctx.json(HealthResponse("ok", "0.1.0", true)) }
        app.get("/v1/sources") { ctx -> ctx.json(runtime.sources()) }
        app.get("/v1/catalog") { ctx ->
            ctx.json(runtime.catalog(
                ctx.queryParam("sourceId") ?: throw IllegalArgumentException("Novel source is required"),
                ctx.queryParam("mode") ?: "popular",
                ctx.queryParam("query"),
                ctx.queryParam("page")?.toIntOrNull() ?: 1,
            ))
        }
        app.get("/v1/novels/{novelId}") { ctx -> ctx.json(runtime.detail(ctx.pathParam("novelId"))) }
        app.get("/v1/novels/{novelId}/chapters") { ctx -> ctx.json(runtime.chapters(ctx.pathParam("novelId"))) }
        app.get("/v1/chapters/{chapterId}") { ctx -> ctx.json(runtime.chapter(ctx.pathParam("chapterId"))) }
        return app
    }
}
