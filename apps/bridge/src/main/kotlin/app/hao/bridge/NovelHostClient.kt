package app.hao.bridge

import kotlinx.serialization.json.Json
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration

class NovelHostRequestException(val status: Int) : IllegalStateException("Novel host returned HTTP $status")

class NovelHostClient(port: Int, private val token: String) {
    private val baseUri = URI("http://127.0.0.1:$port/v1/")
    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build()

    fun isHealthy(): Boolean = runCatching { getText("health", Duration.ofSeconds(2)); true }.getOrDefault(false)
    fun sources(): List<NovelSource> = decode(getText("sources"))
    fun catalog(sourceId: String, mode: String, query: String?, page: Int): NovelSearchResponse {
        val parameters = buildList {
            add("sourceId=${segment(sourceId)}")
            add("mode=${segment(mode)}")
            query?.takeIf(String::isNotBlank)?.let { add("query=${segment(it)}") }
            add("page=$page")
        }.joinToString("&")
        return decode(getText("catalog?$parameters"))
    }
    fun detail(novelId: String): NovelSummary = decode(getText("novels/${segment(novelId)}"))
    fun chapters(novelId: String): List<NovelChapter> = decode(getText("novels/${segment(novelId)}/chapters"))
    fun chapter(chapterId: String): NovelChapterContent = decode(getText("chapters/${segment(chapterId)}"))

    private inline fun <reified T> decode(value: String): T = json.decodeFromString(value)
    private fun getText(path: String, timeout: Duration = Duration.ofSeconds(35)): String {
        val response = http.send(request(path).timeout(timeout).GET().build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
        if (response.statusCode() !in 200..299) throw NovelHostRequestException(response.statusCode())
        return response.body()
    }
    private fun request(path: String) = HttpRequest.newBuilder(baseUri.resolve(path)).header("Authorization", "Bearer $token")
    private fun segment(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")
}
