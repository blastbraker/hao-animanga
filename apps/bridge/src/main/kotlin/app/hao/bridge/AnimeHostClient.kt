package app.hao.bridge

import kotlinx.serialization.json.Json
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

class AnimeHostRequestException(val status: Int) : IllegalStateException("Anime host returned HTTP $status")

class AnimeHostClient(port: Int, private val token: String) {
    private val baseUri = URI("http://127.0.0.1:$port/v1/")
    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build()

    fun isHealthy(): Boolean = runCatching { getText("health"); true }.getOrDefault(false)
    fun catalog(): List<AnimeCatalogItem> = decode(getText("catalog"))
    fun probes(): List<AniyomiApkProbeResult> = decode(getText("extensions/probe"))
    fun episodes(animeId: String): List<AnimeEpisode> = decode(getText("anime/${segment(animeId)}/episodes"))
    fun servers(episodeId: String): List<AnimeServer> = decode(getText("episodes/${segment(episodeId)}/servers"))
    fun streams(episodeId: String, serverId: String): List<AnimeStream> = decode(getText("episodes/${segment(episodeId)}/streams?serverId=${segment(serverId)}"))

    fun media(streamId: String, range: String?): AnimeMediaResponse {
        val builder = request("streams/${segment(streamId)}/media").timeout(Duration.ofSeconds(30)).GET()
        range?.let { builder.header("Range", it) }
        val response = http.send(builder.build(), HttpResponse.BodyHandlers.ofInputStream())
        if (response.statusCode() !in listOf(200, 206)) {
            response.body().close()
            throw AnimeHostRequestException(response.statusCode())
        }
        return AnimeMediaResponse(
            response.statusCode(),
            response.headers().firstValue("content-type").orElse("video/mp4"),
            response.headers().firstValue("content-length").orElse(null),
            response.headers().firstValue("content-range").orElse(null),
            response.headers().firstValue("accept-ranges").orElse("bytes"),
            response.body(),
        )
    }

    private inline fun <reified T> decode(value: String): T = json.decodeFromString(value)

    private fun getText(path: String): String {
        val response = http.send(request(path).timeout(Duration.ofSeconds(10)).GET().build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        if (response.statusCode() !in 200..299) throw AnimeHostRequestException(response.statusCode())
        return response.body()
    }

    private fun request(path: String) = HttpRequest.newBuilder(baseUri.resolve(path)).header("Authorization", "Bearer $token")
    private fun segment(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
}
