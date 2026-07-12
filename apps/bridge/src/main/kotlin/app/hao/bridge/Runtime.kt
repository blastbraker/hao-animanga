package app.hao.bridge

import kotlinx.serialization.Serializable
import java.io.InputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

@Serializable data class RuntimeStatus(val id: String, val kind: MediaKind, val available: Boolean, val message: String)

interface ExtensionRuntime {
    val id: String
    val kind: MediaKind
    fun status(): RuntimeStatus
}

class SuwayomiRuntime(private val manager: SuwayomiManager?) : ExtensionRuntime {
    override val id = "suwayomi"
    override val kind = MediaKind.MANGA
    override fun status(): RuntimeStatus = try {
        val runtime = manager?.status()
        RuntimeStatus(id, kind, runtime?.running == true, runtime?.message ?: "Not configured")
    } catch (error: Exception) {
        RuntimeStatus(id, kind, false, "Unavailable: ${error.message ?: "connection failed"}")
    }
}

class AniyomiCompatibilityRuntime(private val manager: AnimeHostManager) : ExtensionRuntime {
    override val id = "aniyomi-compat"
    override val kind = MediaKind.ANIME
    override fun status(): RuntimeStatus {
        val probes = runCatching { manager.probes() }.getOrElse {
            return RuntimeStatus(id, kind, false, "APK compatibility probe unavailable: ${it.message ?: "host failure"}")
        }
        val linked = probes.count { it.compatible }
        val failed = probes.size - linked
        val message = when {
            probes.isEmpty() -> "No enabled anime APKs are installed"
            failed > 0 -> "$linked APK(s) linked; $failed failed compatibility checks. Execution remains gated"
            else -> "$linked APK(s) passed signature, manifest, API v14, and Dex linkage checks. Execution remains gated"
        }
        return RuntimeStatus(id, kind, false, message)
    }
}

class AnimeHostExtensionRuntime(private val manager: AnimeHostManager) : ExtensionRuntime {
    override val id = "aniyomi-fixture-host"
    override val kind = MediaKind.ANIME
    override fun status() = manager.status()
}

class FixtureAnimeRuntime : ExtensionRuntime {
    override val id = "fixture-anime"
    override val kind = MediaKind.ANIME

    override fun status() = RuntimeStatus(id, kind, true, "Openly licensed fixture runtime ready")
    private val mediaClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build()
    private val fixtureMedia = URI("https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4")

    fun catalog() = listOf(
        AnimeCatalogItem(
            id = "hao-anime-fixture",
            title = "HAO Anime Playback Fixture",
            description = "A CC0 video used to verify HAO's normalized anime playback contract before third-party runtimes are enabled.",
            provider = id,
            attribution = "MDN Web Docs · CC0 media fixture",
        ),
    )

    fun episodes(animeId: String): List<AnimeEpisode> {
        require(animeId == "hao-anime-fixture") { "Anime title was not found" }
        return listOf(AnimeEpisode("hao-anime-fixture-1", animeId, 1.0, "Playback Contract"))
    }

    fun servers(episodeId: String): List<AnimeServer> {
        require(episodeId == "hao-anime-fixture-1") { "Episode was not found" }
        return listOf(AnimeServer("mdn-cc0-mp4", "Local Bridge · MP4"))
    }

    fun streams(episodeId: String, serverId: String): List<AnimeStream> {
        require(episodeId == "hao-anime-fixture-1" && serverId == "mdn-cc0-mp4") { "Episode server was not found" }
        return listOf(
            AnimeStream(
                id = "hao-anime-fixture-hd",
                serverId = serverId,
                url = "/v1/anime/streams/hao-anime-fixture-hd/media",
                kind = "MP4",
                quality = "HD",
                audio = "Original",
            ),
        )
    }

    fun media(streamId: String, range: String?): AnimeMediaResponse {
        require(streamId == "hao-anime-fixture-hd") { "Anime stream was not found" }
        require(range == null || (range != "bytes=-" && range.matches(Regex("bytes=[0-9]*-[0-9]*")))) { "Invalid media range" }
        val request = HttpRequest.newBuilder(fixtureMedia).timeout(Duration.ofSeconds(30)).header("User-Agent", "HAO-Bridge/0.1").GET()
        range?.let { request.header("Range", it) }
        val response = mediaClient.send(request.build(), HttpResponse.BodyHandlers.ofInputStream())
        require(response.statusCode() == 200 || response.statusCode() == 206) { "Fixture media returned HTTP ${response.statusCode()}" }
        return AnimeMediaResponse(
            response.statusCode(),
            response.headers().firstValue("content-type").orElse("video/mp4"),
            response.headers().firstValue("content-length").orElse(null),
            response.headers().firstValue("content-range").orElse(null),
            response.headers().firstValue("accept-ranges").orElse("bytes"),
            response.body(),
        )
    }
}

data class AnimeMediaResponse(
    val status: Int,
    val contentType: String,
    val contentLength: String?,
    val contentRange: String?,
    val acceptRanges: String,
    val body: InputStream,
)
