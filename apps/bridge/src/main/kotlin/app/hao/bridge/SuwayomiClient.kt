package app.hao.bridge

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.InputStream
import java.net.InetAddress
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.Base64

private val suwayomiJson = Json { ignoreUnknownKeys = true }

@Serializable private data class SourceDto(
    val id: String,
    val name: String,
    val displayName: String,
    val lang: String,
    val supportsLatest: Boolean = false,
    val isConfigurable: Boolean = false,
    val isNsfw: Boolean = false,
)

@Serializable private data class MangaDto(
    val id: Int,
    val sourceId: String,
    val title: String,
    val author: String? = null,
    val artist: String? = null,
    val description: String? = null,
    val status: String? = null,
    val genre: List<String> = emptyList(),
)

@Serializable private data class SearchDto(val mangaList: List<MangaDto>, val hasNextPage: Boolean = false)

@Serializable private data class ChapterDto(
    val id: Int,
    val index: Int,
    val name: String,
    val chapterNumber: Float = 0f,
    val scanlator: String? = null,
    val uploadDate: Long = 0,
    val read: Boolean = false,
    val lastPageRead: Int = 0,
    val pageCount: Int = 0,
)

data class BinaryResponse(val contentType: String, val body: InputStream)

class SuwayomiUpstreamException(val status: Int) : IllegalStateException("Suwayomi returned HTTP $status")

class SuwayomiClient(
    endpoint: String,
    username: String? = null,
    password: String? = null,
) {
    private val baseUri = validateEndpoint(endpoint)
    private val authorization = if (!username.isNullOrBlank() && password != null) {
        "Basic " + Base64.getEncoder().encodeToString("$username:$password".toByteArray(StandardCharsets.UTF_8))
    } else null
    private val http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build()

    fun sources(): List<MangaSource> = decode<List<SourceDto>>(getText("source/list"))
        .filter { it.id != "0" }
        .map { MangaSource(it.id, it.name, it.displayName, it.lang, it.supportsLatest, it.isConfigurable, it.isNsfw) }

    fun search(sourceId: String, query: String, page: Int): MangaSearchResponse {
        require(sourceId.matches(Regex("[0-9]+"))) { "Invalid source id" }
        require(query.isNotBlank() && query.length <= 160) { "Search query must be between 1 and 160 characters" }
        require(page in 1..100) { "Page must be between 1 and 100" }
        val encoded = URLEncoder.encode(query.trim(), StandardCharsets.UTF_8)
        val result = decode<SearchDto>(getText("source/$sourceId/search?searchTerm=$encoded&pageNum=$page"))
        return MangaSearchResponse(result.mangaList.map(::summary), result.hasNextPage)
    }

    fun manga(mangaId: Int): MangaSummary {
        require(mangaId > 0) { "Invalid manga id" }
        return summary(decode(getText("manga/$mangaId/full?onlineFetch=true")))
    }

    fun chapters(mangaId: Int): List<MangaChapter> {
        require(mangaId > 0) { "Invalid manga id" }
        return try {
            decode<List<ChapterDto>>(getText("manga/$mangaId/chapters"))
                .map(::chapter)
                .sortedByDescending { it.index }
        } catch (error: SuwayomiUpstreamException) {
            // Suwayomi's legacy REST endpoint reports an empty upstream chapter
            // list as HTTP 500 instead of returning an empty JSON array.
            if (error.status == 500) emptyList() else throw error
        }
    }

    fun pages(mangaId: Int, chapterIndex: Int): MangaChapterPages {
        require(mangaId > 0 && chapterIndex >= 0) { "Invalid manga or chapter" }
        val chapter = decode<ChapterDto>(getText("manga/$mangaId/chapter/$chapterIndex"))
        return MangaChapterPages(
            mangaId,
            chapterIndex,
            chapter.name,
            chapter.pageCount,
            (0 until chapter.pageCount).map { "/v1/manga/$mangaId/chapter/$chapterIndex/page/$it" },
        )
    }

    fun thumbnail(mangaId: Int) = getBinary("manga/$mangaId/thumbnail")

    fun page(mangaId: Int, chapterIndex: Int, pageIndex: Int): BinaryResponse {
        require(mangaId > 0 && chapterIndex >= 0 && pageIndex >= 0) { "Invalid page" }
        return getBinary("manga/$mangaId/chapter/$chapterIndex/page/$pageIndex?updateProgress=true")
    }

    private fun summary(dto: MangaDto) = MangaSummary(dto.id, dto.sourceId, dto.title, dto.author, dto.artist, dto.description, dto.status, dto.genre)
    private fun chapter(dto: ChapterDto) = MangaChapter(dto.id, dto.index, dto.name, dto.chapterNumber, dto.scanlator, dto.uploadDate, dto.read, dto.lastPageRead, dto.pageCount)

    private inline fun <reified T> decode(value: String): T = suwayomiJson.decodeFromString(value)

    private fun getText(path: String): String {
        val response = http.send(request(path).build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        requireSuccess(response.statusCode())
        return response.body()
    }

    private fun getBinary(path: String): BinaryResponse {
        val response = http.send(request(path).build(), HttpResponse.BodyHandlers.ofInputStream())
        if (response.statusCode() !in 200..299) {
            response.body().close()
            requireSuccess(response.statusCode())
        }
        return BinaryResponse(response.headers().firstValue("content-type").orElse("application/octet-stream"), response.body())
    }

    private fun request(path: String): HttpRequest.Builder {
        val uri = baseUri.resolve("api/v1/$path")
        val builder = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(30)).GET()
        authorization?.let { builder.header("Authorization", it) }
        return builder
    }

    private fun requireSuccess(status: Int) {
        if (status !in 200..299) {
            throw SuwayomiUpstreamException(status)
        }
    }

    companion object {
        fun validateEndpoint(value: String): URI {
            val parsed = URI(value.trim())
            require(parsed.userInfo == null && parsed.query == null && parsed.fragment == null) { "Suwayomi URL must not contain credentials, a query, or a fragment" }
            require(parsed.scheme == "https" || parsed.scheme == "http") { "Suwayomi URL must use HTTPS or loopback HTTP" }
            require(!parsed.host.isNullOrBlank()) { "Suwayomi URL must include a host" }
            if (parsed.scheme == "http") {
                val address = InetAddress.getByName(parsed.host)
                require(address.isLoopbackAddress) { "Plain HTTP is allowed only for a loopback Suwayomi server" }
            }
            val normalizedPath = parsed.path.trimEnd('/') + "/"
            return URI(parsed.scheme, null, parsed.host, parsed.port, normalizedPath, null, null)
        }
    }
}
