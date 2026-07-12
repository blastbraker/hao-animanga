package app.hao.bridge

import eu.kanade.tachiyomi.animesource.AnimeCatalogueSource
import eu.kanade.tachiyomi.animesource.AnimeSource
import eu.kanade.tachiyomi.animesource.AnimeSourceFactory
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import kotlinx.serialization.json.Json
import kotlinx.serialization.Serializable
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.net.URI
import java.io.ByteArrayInputStream
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** Executes API-v14 Aniyomi sources inside the contained child runtime. */
class AniyomiFixtureRuntime(private val extensionRoot: Path, private val dataRoot: Path, private val expectedSignerFingerprint: String?) {
    private data class AnimeHandle(val source: AnimeSource, val anime: SAnime)
    private data class EpisodeHandle(val source: AnimeSource, val episode: SEpisode)
    @Serializable private data class StreamHandle(val url: String, val headers: Map<String, List<String>> = emptyMap())

    private val json = Json { ignoreUnknownKeys = true }
    private val probes = AniyomiApkProbe(extensionRoot, dataRoot)
    private val anime = ConcurrentHashMap<String, AnimeHandle>()
    private val episodes = ConcurrentHashMap<String, EpisodeHandle>()
    private val streams = ConcurrentHashMap<String, StreamHandle>()
    private val loaders = mutableListOf<ExtensionClassLoader>()
    private val sourcePackages = ConcurrentHashMap<Long, InstalledPackage>()
    @Volatile private var sources: List<AnimeSource>? = null
    private val mediaClient = eu.kanade.tachiyomi.network.NetworkRuntime.client()

    fun catalog(): List<AnimeCatalogItem> = loadSources().flatMap { source ->
        runCatching {
            val catalogue = source as? AnimeCatalogueSource ?: return@runCatching emptyList()
            val page = catalogue.fetchPopularAnime(1).timeout(20, TimeUnit.SECONDS).toBlocking().single()
            val installed = sourcePackages[source.id]
            page.animes.map { item ->
                val id = stableId("anime", source.id.toString(), item.url)
                anime[id] = AnimeHandle(source, item)
                AnimeCatalogItem(id, item.title, item.description ?: "No description supplied by this source.", source.name, installed?.displayName ?: "Aniyomi extension")
            }
        }.getOrElse { error ->
            System.err.println("Aniyomi source ${source.name} catalog failed: ${error.message ?: error.javaClass.simpleName}")
            emptyList()
        }
    }

    fun episodes(animeId: String): List<AnimeEpisode> {
        val handle = anime[animeId] ?: run {
            // The containing process can be restarted after a provider failure.
            // Rebuild deterministic catalog handles before rejecting a browser-held id.
            catalog()
            anime[animeId]
        } ?: throw IllegalArgumentException("Aniyomi anime title was not found")
        return runCatching {
            runBlocking { withTimeout(30_000) { handle.source.getEpisodeList(handle.anime) } }.map { item ->
                val id = stableId("episode", handle.source.id.toString(), item.url)
                episodes[id] = EpisodeHandle(handle.source, item)
                AnimeEpisode(id, animeId, item.episode_number.toDouble(), item.name)
            }
        }.getOrElse { error ->
            error.printStackTrace()
            throw IllegalArgumentException("Aniyomi episode loading failed: ${error.message ?: error.javaClass.simpleName}", error)
        }
    }

    fun servers(episodeId: String): List<AnimeServer> {
        require(episodes.containsKey(episodeId)) { "Aniyomi episode was not found" }
        return listOf(AnimeServer("aniyomi", "Aniyomi extension"))
    }

    fun streams(episodeId: String, serverId: String): List<AnimeStream> {
        require(serverId == "aniyomi") { "Aniyomi server was not found" }
        val handle = episodes[episodeId] ?: throw IllegalArgumentException("Aniyomi episode was not found")
        return runBlocking { withTimeout(40_000) { handle.source.getVideoList(handle.episode) } }.mapNotNull { video ->
            runCatching {
                val mediaUrl = video.videoUrl ?: video.url
                AnimeNetworkPolicy.allowRemoteHttps(mediaUrl)
                val subtitles = video.subtitleTracks.filter { track ->
                    runCatching { AnimeNetworkPolicy.allowRemoteHttps(track.url) }.isSuccess
                }
                val playable = video.copy(subtitleTracks = subtitles)
                val id = stableId("stream", episodeId, mediaUrl)
                val handle = StreamHandle(mediaUrl, playable.headers?.toMultimap() ?: emptyMap())
                streams[id] = handle
                persistStream(id, handle)
                AnimeStream(
                    id,
                    serverId,
                    "/v1/anime/streams/$id/media",
                    if (mediaUrl.contains(".m3u8", true)) "HLS" else "MP4",
                    playable.quality,
                    playable.audioTracks.firstOrNull()?.lang,
                    subtitles.map { AnimeSubtitle(it.lang, it.lang, it.url) },
                )
            }.getOrElse { error ->
                System.err.println("Aniyomi discarded an unsafe stream: ${error.message ?: error.javaClass.simpleName}")
                null
            }
        }
    }

    fun media(streamId: String, range: String?): AnimeMediaResponse {
        val video = streams[streamId] ?: loadStream(streamId) ?: throw IllegalArgumentException("Aniyomi stream was not found")
        val uri = URI(video.url)
        // Persisted stream descriptors can outlive the child process that first
        // approved their CDN. Re-run public-HTTPS validation after recovery.
        AnimeNetworkPolicy.allowRemoteHttps(uri.toString())
        require(range == null || (range != "bytes=-" && range.matches(Regex("bytes=[0-9]*-[0-9]*")))) { "Invalid media range" }
        val request = okhttp3.Request.Builder().url(uri.toString()).header("User-Agent", "HAO-Bridge/0.1").get()
        video.headers.forEach { (name, values) ->
            if (!name.equals("Host", true) && !name.equals("Content-Length", true)) values.forEach { request.header(name, it) }
        }
        range?.let { request.header("Range", it) }
        val response = mediaClient.newCall(request.build()).execute()
        require(response.code in listOf(200, 206)) { response.close(); "Aniyomi media returned HTTP ${response.code}" }
        val body = response.body
        val contentType = response.header("content-type") ?: "video/mp4"
        if (contentType.contains("mpegurl", true) || uri.path.endsWith(".m3u8", true)) {
            val manifest = body.string()
            response.close()
            val rewritten = rewriteHlsManifest(uri, manifest, video.headers).toByteArray()
            return AnimeMediaResponse(200, "application/vnd.apple.mpegurl", rewritten.size.toString(), null, "none", ByteArrayInputStream(rewritten))
        }
        return AnimeMediaResponse(
            response.code,
            contentType,
            response.header("content-length"),
            response.header("content-range"),
            response.header("accept-ranges") ?: "bytes",
            body.byteStream(),
        )
    }

    @Synchronized private fun loadSources(): List<AnimeSource> {
        sources?.let { return it }
        val compatiblePackages = probes.probeInstalled().filter { it.compatible && it.runtimeCompatible }
        val loaded = compatiblePackages.flatMap { probe ->
            val directory = extensionRoot.resolve("anime").resolve(probe.packageName)
            val installed = json.decodeFromString<InstalledPackage>(Files.readString(directory.resolve("metadata.json")))
            if (installed.packageName == FIXTURE_PACKAGE && expectedSignerFingerprint != null) {
                require(installed.signerFingerprint == expectedSignerFingerprint) { "Fixture signer does not match the configured APK" }
            }
            val translated = dataRoot.resolve("translated").resolve("${installed.sha256}.jar")
            require(Files.isRegularFile(translated)) { "Fixture Dex translation is missing" }
            val loader = ExtensionClassLoader(arrayOf(translated.toUri().toURL()), javaClass.classLoader, directory)
            loaders += loader
            probe.sourceClasses.flatMap { className ->
                when (val instance = Class.forName(className, true, loader).getDeclaredConstructor().newInstance()) {
                    is AnimeSource -> listOf(instance)
                    is AnimeSourceFactory -> instance.createSources()
                    else -> throw IllegalArgumentException("Declared class is not an Aniyomi source")
                }
            }.onEach { source ->
                sourcePackages[source.id] = installed
                val httpSource = source as? eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
                if (httpSource != null) AnimeNetworkPolicy.allowRemoteHttps(httpSource.baseUrl)
            }
        }
        sources = loaded
        return loaded
    }

    private fun stableId(type: String, owner: String, value: String) = "$ID_PREFIX$type-${Security.sha256("$owner\u0000$value".toByteArray()).take(24)}"

    private fun persistStream(id: String, stream: StreamHandle) {
        require(id.matches(Regex("aniyomi-stream-[a-f0-9]{24}"))) { "Invalid Aniyomi stream id" }
        val directory = dataRoot.resolve("streams")
        Files.createDirectories(directory)
        Files.writeString(directory.resolve("$id.json"), json.encodeToString(StreamHandle.serializer(), stream))
    }

    private fun loadStream(id: String): StreamHandle? {
        if (!id.matches(Regex("aniyomi-stream-[a-f0-9]{24}"))) return null
        val path = dataRoot.resolve("streams").resolve("$id.json").normalize()
        if (path.parent != dataRoot.resolve("streams").normalize() || !Files.isRegularFile(path)) return null
        return runCatching { json.decodeFromString(StreamHandle.serializer(), Files.readString(path)) }.getOrNull()
    }

    private fun rewriteHlsManifest(base: URI, manifest: String, headers: Map<String, List<String>>): String =
        manifest.lineSequence().joinToString("\n") { line ->
            val trimmed = line.trim()
            when {
                trimmed.isBlank() || trimmed.startsWith("#") -> HLS_URI.replace(line) { match ->
                    "URI=\"${registerHlsResource(base.resolve(match.groupValues[1]), headers)}\""
                }
                else -> registerHlsResource(base.resolve(trimmed), headers)
            }
        }

    private fun registerHlsResource(uri: URI, headers: Map<String, List<String>>): String {
        AnimeNetworkPolicy.allowRemoteHttps(uri.toString())
        val id = stableId("stream", "hls", uri.toString())
        val handle = StreamHandle(uri.toString(), headers)
        streams[id] = handle
        persistStream(id, handle)
        return "/v1/anime/streams/$id/media"
    }

    companion object {
        const val ID_PREFIX = "aniyomi-"
        const val FIXTURE_PACKAGE = "app.hao.fixture.anime"
        private val HLS_URI = Regex("URI=\\\"([^\\\"]+)\\\"")
    }
}
