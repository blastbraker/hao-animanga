/* Apache-2.0 implementation adapted from Aniyomi v0.15.2.4. */
package eu.kanade.tachiyomi.animesource.online

import eu.kanade.tachiyomi.animesource.AnimeCatalogueSource
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.asObservableSuccess
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import rx.Observable
import java.net.URI
import java.security.MessageDigest

abstract class AnimeHttpSource : AnimeCatalogueSource {
    protected val network = NetworkHelper()
    abstract val baseUrl: String
    open val versionId = 1
    override val id by lazy { generateId(name, lang, versionId) }
    val headers: Headers by lazy { headersBuilder().build() }
    open val client: OkHttpClient get() = network.client

    protected fun generateId(name: String, lang: String, versionId: Int): Long {
        val bytes = MessageDigest.getInstance("MD5").digest("${name.lowercase()}/$lang/$versionId".toByteArray())
        return (0..7).map { bytes[it].toLong() and 0xff shl 8 * (7 - it) }.reduce(Long::or) and Long.MAX_VALUE
    }

    protected open fun headersBuilder() = Headers.Builder().add("User-Agent", network.defaultUserAgentProvider())
    override fun toString() = "$name (${lang.uppercase()})"

    override fun fetchPopularAnime(page: Int): Observable<AnimesPage> =
        client.newCall(popularAnimeRequest(page)).asObservableSuccess().map(::popularAnimeParse)
    protected abstract fun popularAnimeRequest(page: Int): Request
    protected abstract fun popularAnimeParse(response: Response): AnimesPage

    override fun fetchSearchAnime(page: Int, query: String, filters: AnimeFilterList): Observable<AnimesPage> =
        Observable.defer { client.newCall(searchAnimeRequest(page, query, filters)).asObservableSuccess() }.map(::searchAnimeParse)
    protected abstract fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request
    protected abstract fun searchAnimeParse(response: Response): AnimesPage

    override fun fetchLatestUpdates(page: Int): Observable<AnimesPage> =
        client.newCall(latestUpdatesRequest(page)).asObservableSuccess().map(::latestUpdatesParse)
    protected abstract fun latestUpdatesRequest(page: Int): Request
    protected abstract fun latestUpdatesParse(response: Response): AnimesPage

    override suspend fun getPopularAnime(page: Int) = fetchPopularAnime(page).toBlocking().single()
    override suspend fun getSearchAnime(page: Int, query: String, filters: AnimeFilterList) = fetchSearchAnime(page, query, filters).toBlocking().single()
    override suspend fun getLatestUpdates(page: Int) = fetchLatestUpdates(page).toBlocking().single()

    override suspend fun getAnimeDetails(anime: SAnime) = fetchAnimeDetails(anime).toBlocking().single()
    override fun fetchAnimeDetails(anime: SAnime): Observable<SAnime> =
        client.newCall(animeDetailsRequest(anime)).asObservableSuccess().map { animeDetailsParse(it).apply { initialized = true } }
    open fun animeDetailsRequest(anime: SAnime): Request = GET(baseUrl + anime.url, headers)
    protected abstract fun animeDetailsParse(response: Response): SAnime

    override suspend fun getEpisodeList(anime: SAnime) = fetchEpisodeList(anime).toBlocking().single()
    override fun fetchEpisodeList(anime: SAnime): Observable<List<SEpisode>> =
        client.newCall(episodeListRequest(anime)).asObservableSuccess().map(::episodeListParse)
    protected open fun episodeListRequest(anime: SAnime): Request = GET(baseUrl + anime.url, headers)
    protected abstract fun episodeListParse(response: Response): List<SEpisode>
    protected abstract fun episodeVideoParse(response: Response): SEpisode

    override suspend fun getVideoList(episode: SEpisode) = fetchVideoList(episode).toBlocking().single()
    override fun fetchVideoList(episode: SEpisode): Observable<List<Video>> =
        client.newCall(videoListRequest(episode)).asObservableSuccess().map { videoListParse(it).sort() }
    protected open fun videoListRequest(episode: SEpisode): Request = GET(baseUrl + episode.url, headers)
    protected abstract fun videoListParse(response: Response): List<Video>
    protected open fun List<Video>.sort(): List<Video> = this

    open fun fetchVideoUrl(video: Video): Observable<String> =
        client.newCall(videoUrlRequest(video)).asObservableSuccess().map(::videoUrlParse)
    protected open fun videoUrlRequest(video: Video): Request = GET(video.url, headers)
    protected abstract fun videoUrlParse(response: Response): String

    fun SEpisode.setUrlWithoutDomain(url: String) { this.url = urlWithoutDomain(url) }
    fun SAnime.setUrlWithoutDomain(url: String) { this.url = urlWithoutDomain(url) }
    private fun urlWithoutDomain(value: String): String = runCatching {
        URI(value).let { uri -> uri.path + (uri.query?.let { "?$it" } ?: "") + (uri.fragment?.let { "#$it" } ?: "") }
    }.getOrDefault(value)

    open fun getAnimeUrl(anime: SAnime): String = animeDetailsRequest(anime).url.toString()
    open fun getEpisodeUrl(episode: SEpisode): String = episode.url
    open fun prepareNewEpisode(episode: SEpisode, anime: SAnime) {}
    override fun getFilterList() = AnimeFilterList()
}

class LicensedEntryItemsException : RuntimeException()
