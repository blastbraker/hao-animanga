package app.hao.bridge

import eu.kanade.tachiyomi.animesource.AnimeCatalogueSource
import eu.kanade.tachiyomi.animesource.AnimeSource
import eu.kanade.tachiyomi.animesource.AnimeSourceFactory
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import kotlinx.serialization.json.Json
import java.net.URI
import java.net.URLClassLoader
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Executes only HAO's purpose-built fixture APK. Third-party package execution stays gated. */
class AniyomiFixtureRuntime(private val extensionRoot: Path, private val dataRoot: Path, private val expectedSignerFingerprint: String?) {
    private data class AnimeHandle(val source: AnimeSource, val anime: SAnime)
    private data class EpisodeHandle(val source: AnimeSource, val episode: SEpisode)
    private data class StreamHandle(val video: Video)

    private val json = Json { ignoreUnknownKeys = true }
    private val probes = AniyomiApkProbe(extensionRoot, dataRoot)
    private val anime = ConcurrentHashMap<String, AnimeHandle>()
    private val episodes = ConcurrentHashMap<String, EpisodeHandle>()
    private val streams = ConcurrentHashMap<String, StreamHandle>()
    private val loaders = mutableListOf<URLClassLoader>()
    @Volatile private var sources: List<AnimeSource>? = null
    private val mediaClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build()

    fun catalog(): List<AnimeCatalogItem> = loadSources().flatMap { source ->
        val catalogue = source as? AnimeCatalogueSource ?: return@flatMap emptyList()
        val page = catalogue.fetchPopularAnime(1).timeout(8, TimeUnit.SECONDS).toBlocking().single()
        page.animes.map { item ->
            val id = stableId("anime", source.id.toString(), item.url)
            anime[id] = AnimeHandle(source, item)
            AnimeCatalogItem(id, item.title, item.description ?: "No description supplied by this fixture.", source.name, "HAO signed fixture extension")
        }
    }

    fun episodes(animeId: String): List<AnimeEpisode> {
        val handle = anime[animeId] ?: throw IllegalArgumentException("Fixture anime title was not found")
        return handle.source.fetchEpisodeList(handle.anime).timeout(8, TimeUnit.SECONDS).toBlocking().single().map { item ->
            val id = stableId("episode", handle.source.id.toString(), item.url)
            episodes[id] = EpisodeHandle(handle.source, item)
            AnimeEpisode(id, animeId, item.episode_number.toDouble(), item.name)
        }
    }

    fun servers(episodeId: String): List<AnimeServer> {
        require(episodes.containsKey(episodeId)) { "Fixture episode was not found" }
        return listOf(AnimeServer("aniyomi-fixture", "HAO fixture source"))
    }

    fun streams(episodeId: String, serverId: String): List<AnimeStream> {
        require(serverId == "aniyomi-fixture") { "Fixture server was not found" }
        val handle = episodes[episodeId] ?: throw IllegalArgumentException("Fixture episode was not found")
        return handle.source.fetchVideoList(handle.episode).timeout(8, TimeUnit.SECONDS).toBlocking().single().map { video ->
            val id = stableId("stream", episodeId, video.videoUrl ?: video.url)
            streams[id] = StreamHandle(video)
            AnimeStream(
                id,
                serverId,
                "/v1/anime/streams/$id/media",
                if ((video.videoUrl ?: video.url).contains(".m3u8", true)) "HLS" else "MP4",
                video.quality,
                video.audioTracks.firstOrNull()?.lang,
                video.subtitleTracks.map { AnimeSubtitle(it.lang, it.lang, it.url) },
            )
        }
    }

    fun media(streamId: String, range: String?): AnimeMediaResponse {
        val video = streams[streamId]?.video ?: throw IllegalArgumentException("Fixture stream was not found")
        val uri = URI(video.videoUrl ?: video.url)
        require(uri.scheme == "https" && uri.host == FIXTURE_MEDIA_HOST) { "Fixture media host is not allowlisted" }
        require(range == null || (range != "bytes=-" && range.matches(Regex("bytes=[0-9]*-[0-9]*")))) { "Invalid media range" }
        val request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(30)).header("User-Agent", "HAO-Bridge-Fixture/0.1").GET()
        range?.let { request.header("Range", it) }
        val response = mediaClient.send(request.build(), HttpResponse.BodyHandlers.ofInputStream())
        require(response.statusCode() in listOf(200, 206)) { "Fixture media returned HTTP ${response.statusCode()}" }
        return AnimeMediaResponse(
            response.statusCode(),
            response.headers().firstValue("content-type").orElse("video/mp4"),
            response.headers().firstValue("content-length").orElse(null),
            response.headers().firstValue("content-range").orElse(null),
            response.headers().firstValue("accept-ranges").orElse("bytes"),
            response.body(),
        )
    }

    @Synchronized private fun loadSources(): List<AnimeSource> {
        sources?.let { return it }
        if (expectedSignerFingerprint == null) return emptyList<AnimeSource>().also { sources = it }
        val compatiblePackages = probes.probeInstalled().filter { it.compatible && it.packageName == FIXTURE_PACKAGE }
        val loaded = compatiblePackages.flatMap { probe ->
            val directory = extensionRoot.resolve("anime").resolve(probe.packageName)
            val installed = json.decodeFromString<InstalledPackage>(Files.readString(directory.resolve("metadata.json")))
            require(installed.signerFingerprint == expectedSignerFingerprint) { "Fixture signer does not match the configured APK" }
            val translated = dataRoot.resolve("translated").resolve("${installed.sha256}.jar")
            require(Files.isRegularFile(translated)) { "Fixture Dex translation is missing" }
            val loader = URLClassLoader(arrayOf(translated.toUri().toURL()), javaClass.classLoader)
            loaders += loader
            probe.sourceClasses.flatMap { className ->
                when (val instance = Class.forName(className, true, loader).getDeclaredConstructor().newInstance()) {
                    is AnimeSource -> listOf(instance)
                    is AnimeSourceFactory -> instance.createSources()
                    else -> throw IllegalArgumentException("Fixture class is not an Aniyomi source")
                }
            }
        }
        sources = loaded
        return loaded
    }

    private fun stableId(type: String, owner: String, value: String) = "$ID_PREFIX$type-${Security.sha256("$owner\u0000$value".toByteArray()).take(24)}"

    companion object {
        const val ID_PREFIX = "aniyomi-fixture-"
        const val FIXTURE_PACKAGE = "app.hao.fixture.anime"
        private const val FIXTURE_MEDIA_HOST = "interactive-examples.mdn.mozilla.net"
    }
}
